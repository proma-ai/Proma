/**
 * useGlobalAgentListeners — 全局 Agent IPC 监听器
 *
 * 在应用顶层挂载，永不销毁。将所有 Agent 流式事件、
 * 权限请求、AskUser 请求写入对应 Jotai atoms。
 *
 * 使用 useStore() 直接操作 atoms，避免 React 订阅。
 */

import { useEffect } from 'react'
import { useStore } from 'jotai'
import {
  agentStreamingStatesAtom,
  agentStreamErrorsAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentMessagesAtom,
  allPendingPermissionRequestsAtom,
  allPendingAskUserRequestsAtom,
  backgroundTasksAtomFamily,
  applyAgentEvent,
} from '@/atoms/agent-atoms'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import type { AgentStreamEvent } from '@proma/shared'

export function useGlobalAgentListeners(): void {
  const store = useStore()

  useEffect(() => {
    // ===== 1. 流式事件 =====
    const cleanupEvent = window.electronAPI.onAgentStreamEvent(
      (streamEvent: AgentStreamEvent) => {
        const { sessionId, event } = streamEvent

        // 更新流式状态
        store.set(agentStreamingStatesAtom, (prev) => {
          const current: AgentStreamState = prev.get(sessionId) ?? {
            running: true,
            content: '',
            toolActivities: [],
            model: undefined,
            startedAt: Date.now(),
          }
          const next = applyAgentEvent(current, event)
          const map = new Map(prev)
          map.set(sessionId, next)
          return map
        })

        // 处理后台任务事件
        if (event.type === 'task_backgrounded') {
          store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
            if (prev.some((t) => t.toolUseId === event.toolUseId)) return prev
            return [...prev, {
              id: event.taskId,
              type: 'agent' as const,
              toolUseId: event.toolUseId,
              startTime: Date.now(),
              elapsedSeconds: 0,
              intent: event.intent,
            }]
          })
        } else if (event.type === 'task_progress') {
          store.set(backgroundTasksAtomFamily(sessionId), (prev) =>
            prev.map((t) =>
              t.toolUseId === event.toolUseId
                ? { ...t, elapsedSeconds: event.elapsedSeconds }
                : t
            )
          )
        } else if (event.type === 'shell_backgrounded') {
          store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
            if (prev.some((t) => t.toolUseId === event.toolUseId)) return prev
            return [...prev, {
              id: event.shellId,
              type: 'shell' as const,
              toolUseId: event.toolUseId,
              startTime: Date.now(),
              elapsedSeconds: 0,
              intent: event.command || event.intent,
            }]
          })
        } else if (event.type === 'tool_result') {
          // 工具完成时，移除对应的后台任务
          store.set(backgroundTasksAtomFamily(sessionId), (prev) =>
            prev.filter((t) => t.toolUseId !== event.toolUseId)
          )
        } else if (event.type === 'shell_killed') {
          store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
            const task = prev.find((t) => t.id === event.shellId)
            if (!task) return prev
            return prev.filter((t) => t.toolUseId !== task.toolUseId)
          })
        }
      }
    )

    // ===== 2. 流式完成 =====
    const cleanupComplete = window.electronAPI.onAgentStreamComplete(
      (data: { sessionId: string }) => {
        const currentId = store.get(currentAgentSessionIdAtom)

        const finalize = (): void => {
          // 移除流式状态
          store.set(agentStreamingStatesAtom, (prev) => {
            if (!prev.has(data.sessionId)) return prev
            const map = new Map(prev)
            map.delete(data.sessionId)
            return map
          })

          // 清理后台任务
          store.set(backgroundTasksAtomFamily(data.sessionId), [])

          // 刷新会话列表
          window.electronAPI
            .listAgentSessions()
            .then((sessions) => {
              store.set(agentSessionsAtom, sessions)
            })
            .catch(console.error)
        }

        if (data.sessionId === currentId) {
          window.electronAPI
            .getAgentSessionMessages(data.sessionId)
            .then((messages) => {
              store.set(currentAgentMessagesAtom, messages)
              finalize()
            })
            .catch(() => finalize())
        } else {
          finalize()
        }
      }
    )

    // ===== 3. 流式错误 =====
    const cleanupError = window.electronAPI.onAgentStreamError(
      (data: { sessionId: string; error: string }) => {
        console.error('[GlobalAgentListeners] 流式错误:', data.error)

        // 存储错误消息
        store.set(agentStreamErrorsAtom, (prev) => {
          const map = new Map(prev)
          map.set(data.sessionId, data.error)
          return map
        })

        // 重新加载当前会话的消息
        const currentId = store.get(currentAgentSessionIdAtom)
        if (data.sessionId === currentId) {
          window.electronAPI
            .getAgentSessionMessages(data.sessionId)
            .then((messages) => {
              store.set(currentAgentMessagesAtom, messages)
            })
            .catch((error) => {
              console.error('[GlobalAgentListeners] 加载消息失败:', error)
            })
        }
      }
    )

    // ===== 4. 标题更新 =====
    const cleanupTitleUpdated = window.electronAPI.onAgentTitleUpdated(() => {
      window.electronAPI
        .listAgentSessions()
        .then((sessions) => {
          store.set(agentSessionsAtom, sessions)
        })
        .catch(console.error)
    })

    // ===== 5. 权限请求 — 入队所有会话，不区分当前/后台 =====
    const cleanupPermission = window.electronAPI.onPermissionRequest(
      (data) => {
        const { sessionId, request } = data
        store.set(allPendingPermissionRequestsAtom, (prev) => {
          const map = new Map(prev)
          const current = map.get(sessionId) ?? []
          map.set(sessionId, [...current, request])
          return map
        })
      }
    )

    // ===== 6. AskUser 请求 — 入队所有会话，不区分当前/后台 =====
    const cleanupAskUser = window.electronAPI.onAskUserRequest(
      (data) => {
        const { sessionId, request } = data
        store.set(allPendingAskUserRequestsAtom, (prev) => {
          const map = new Map(prev)
          const current = map.get(sessionId) ?? []
          map.set(sessionId, [...current, request])
          return map
        })
      }
    )

    return () => {
      cleanupEvent()
      cleanupComplete()
      cleanupError()
      cleanupTitleUpdated()
      cleanupPermission()
      cleanupAskUser()
    }
  }, [store]) // store 引用稳定，effect 只执行一次
}
