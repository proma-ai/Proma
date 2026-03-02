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
  agentMessageRefreshAtom,
  allPendingPermissionRequestsAtom,
  allPendingAskUserRequestsAtom,
  agentPromptSuggestionsAtom,
  backgroundTasksAtomFamily,
  agentSidePanelOpenMapAtom,
  agentSidePanelTabMapAtom,
  cachedTeamActivitiesAtom,
  buildTeamActivityEntries,
  applyAgentEvent,
} from '@/atoms/agent-atoms'
import {
  notificationsEnabledAtom,
  sendDesktopNotification,
} from '@/atoms/notifications'
import { tabsAtom, updateTabTitle } from '@/atoms/tab-atoms'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import type { AgentStreamEvent, AgentStreamCompletePayload } from '@proma/shared'

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

        // 自动打开侧面板：检测到 Agent/Task 工具启动时
        if (event.type === 'tool_start' && (event.toolName === 'Agent' || event.toolName === 'Task')) {
          store.set(agentSidePanelOpenMapAtom, (prev) => {
            const map = new Map(prev)
            map.set(sessionId, true)
            return map
          })
          store.set(agentSidePanelTabMapAtom, (prev) => {
            const map = new Map(prev)
            map.set(sessionId, 'team')
            return map
          })
        }

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
        } else if (event.type === 'prompt_suggestion') {
          // 存储提示建议到 atom
          console.log(`[GlobalAgentListeners] 收到建议: sessionId=${sessionId}, suggestion="${event.suggestion.slice(0, 50)}..."`)
          store.set(agentPromptSuggestionsAtom, (prev) => {
            const map = new Map(prev)
            map.set(sessionId, event.suggestion)
            return map
          })
        } else if (event.type === 'permission_request') {
          // 权限请求入队（统一通道，不区分当前/后台会话）
          store.set(allPendingPermissionRequestsAtom, (prev) => {
            const map = new Map(prev)
            const current = map.get(sessionId) ?? []
            map.set(sessionId, [...current, event.request])
            return map
          })
          // 桌面通知
          const enabled = store.get(notificationsEnabledAtom)
          sendDesktopNotification(
            '需要权限确认',
            event.request.toolName
              ? `Agent 请求使用工具: ${event.request.toolName}`
              : 'Agent 需要你的权限确认',
            enabled
          )
        } else if (event.type === 'ask_user_request') {
          // AskUser 请求入队（统一通道，不区分当前/后台会话）
          store.set(allPendingAskUserRequestsAtom, (prev) => {
            const map = new Map(prev)
            const current = map.get(sessionId) ?? []
            map.set(sessionId, [...current, event.request])
            return map
          })
          // 桌面通知
          const enabled = store.get(notificationsEnabledAtom)
          sendDesktopNotification(
            'Agent 需要你的输入',
            event.request.questions[0]?.question ?? 'Agent 有问题需要你回答',
            enabled
          )
        }
      }
    )

    // ===== 2. 流式完成 =====
    const cleanupComplete = window.electronAPI.onAgentStreamComplete(
      (data: AgentStreamCompletePayload) => {
        // 发送桌面通知
        const enabled = store.get(notificationsEnabledAtom)
        const sessions = store.get(agentSessionsAtom)
        const session = sessions.find((s) => s.id === data.sessionId)
        sendDesktopNotification(
          'Agent 任务完成',
          session?.title ?? '任务已完成',
          enabled
        )

        // STREAM_COMPLETE 表示后端已完全结束 — 立即标记 running: false
        // （complete 事件只清除 retrying，保持 running: true 以防竞态）
        store.set(agentStreamingStatesAtom, (prev) => {
          const current = prev.get(data.sessionId)
          if (!current || !current.running) return prev
          const map = new Map(prev)
          map.set(data.sessionId, { ...current, running: false })
          return map
        })

        // 缓存 Team 活动数据（在流式状态被清除前保存，防止面板数据丢失）
        const streamState = store.get(agentStreamingStatesAtom).get(data.sessionId)
        if (streamState && streamState.toolActivities.length > 0) {
          const teamEntries = buildTeamActivityEntries(streamState.toolActivities)
          if (teamEntries.length > 0) {
            store.set(cachedTeamActivitiesAtom, (prev) => {
              const map = new Map(prev)
              map.set(data.sessionId, teamEntries)
              return map
            })
          }
        }

        /** 竞态保护：检查该会话是否已有新的流式请求正在运行 */
        const isNewStreamRunning = (): boolean => {
          const state = store.get(agentStreamingStatesAtom).get(data.sessionId)
          return state?.running === true
        }

        /** 递增消息刷新版本号，通知 AgentView 重新加载消息 */
        const bumpRefresh = (): void => {
          store.set(agentMessageRefreshAtom, (prev) => {
            const map = new Map(prev)
            map.set(data.sessionId, (prev.get(data.sessionId) ?? 0) + 1)
            return map
          })
        }

        const finalize = (): void => {
          // 竞态保护：新流已启动时不要清理状态
          if (isNewStreamRunning()) return

          // 清理后台任务
          store.set(backgroundTasksAtomFamily(data.sessionId), [])

          // 刷新会话列表
          window.electronAPI
            .listAgentSessions()
            .then((sessions) => {
              store.set(agentSessionsAtom, sessions)
            })
            .catch(console.error)

          // 注意：流式状态的完全清除由 AgentView 在消息加载完成后执行，
          // 确保不会出现「气泡消失 → 持久化消息尚未加载」的空档闪烁
        }

        // 通知 AgentView 重新加载消息（无论是否为当前会话）
        if (!isNewStreamRunning()) {
          bumpRefresh()
        }
        finalize()
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

        // 递增消息刷新版本号，通知 AgentView 重新加载消息
        const state = store.get(agentStreamingStatesAtom).get(data.sessionId)
        if (!state?.running) {
          store.set(agentMessageRefreshAtom, (prev) => {
            const map = new Map(prev)
            map.set(data.sessionId, (prev.get(data.sessionId) ?? 0) + 1)
            return map
          })
        }
      }
    )

    // ===== 4. 标题更新 =====
    const cleanupTitleUpdated = window.electronAPI.onAgentTitleUpdated(() => {
      window.electronAPI
        .listAgentSessions()
        .then((sessions) => {
          const prevSessions = store.get(agentSessionsAtom)
          store.set(agentSessionsAtom, sessions)
          // 同步更新标签页标题（比较新旧标题，有变化才更新）
          for (const session of sessions) {
            const prev = prevSessions.find((s) => s.id === session.id)
            if (prev && prev.title !== session.title) {
              store.set(tabsAtom, (tabs) => updateTabTitle(tabs, session.id, session.title))
            }
          }
        })
        .catch(console.error)
    })

    return () => {
      cleanupEvent()
      cleanupComplete()
      cleanupError()
      cleanupTitleUpdated()
    }
  }, [store]) // store 引用稳定，effect 只执行一次
}
