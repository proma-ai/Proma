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
  allPendingExitPlanRequestsAtom,
  agentPromptSuggestionsAtom,
  backgroundTasksAtomFamily,
  agentSidePanelOpenMapAtom,
  applyAgentEvent,
  liveMessagesMapAtom,
  agentPermissionModeMapAtom,
  stoppedByUserSessionsAtom,
  agentPlanModeSessionsAtom,
  finalizeStreamingActivities,
} from '@/atoms/agent-atoms'
import {
  notificationsEnabledAtom,
  sendDesktopNotification,
} from '@/atoms/notifications'
import { tabsAtom, updateTabTitle } from '@/atoms/tab-atoms'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import type { AgentStreamEvent, AgentStreamCompletePayload, AgentEvent, AgentStreamPayload, SDKAssistantMessage, SDKUserMessage, SDKSystemMessage, SDKContentBlock, SDKUserContentBlock } from '@proma/shared'

// ============================================================================
// Phase 1 临时兼容层：将 AgentStreamPayload 转换为旧 AgentEvent
// Phase 2 将移除此转换，直接使用 SDKMessage 渲染
// ============================================================================

function payloadToLegacyEvents(payload: AgentStreamPayload): AgentEvent[] {
  if (payload.kind === 'proma_event') {
    const evt = payload.event
    switch (evt.type) {
      case 'permission_request':
        return [{ type: 'permission_request', request: evt.request }]
      case 'permission_resolved':
        return [{ type: 'permission_resolved', requestId: evt.requestId, behavior: evt.behavior }]
      case 'ask_user_request':
        return [{ type: 'ask_user_request', request: evt.request }]
      case 'ask_user_resolved':
        return [{ type: 'ask_user_resolved', requestId: evt.requestId }]
      case 'exit_plan_mode_request':
        return [{ type: 'exit_plan_mode_request', request: evt.request }]
      case 'exit_plan_mode_resolved':
        return [{ type: 'exit_plan_mode_resolved', requestId: evt.requestId }]
      case 'enter_plan_mode':
        return [{ type: 'enter_plan_mode', sessionId: evt.sessionId }]
      case 'model_resolved':
        return [{ type: 'model_resolved', model: evt.model }]
      case 'permission_mode_changed':
        return [{ type: 'permission_mode_changed', mode: evt.mode }]
      case 'waiting_resume':
        return [{ type: 'waiting_resume', message: evt.message }]
      case 'resume_start':
        return [{ type: 'resume_start', messageId: evt.messageId }]
      case 'retry': {
        const events: AgentEvent[] = []
        if (evt.status === 'starting' && evt.attempt != null && evt.maxAttempts != null) {
          events.push({ type: 'retrying', attempt: evt.attempt, maxAttempts: evt.maxAttempts, delaySeconds: evt.delaySeconds ?? 0, reason: evt.reason ?? '' })
        }
        if (evt.status === 'attempt' && evt.attemptData) {
          events.push({ type: 'retry_attempt', attemptData: evt.attemptData })
        }
        if (evt.status === 'cleared') {
          events.push({ type: 'retry_cleared' })
        }
        if (evt.status === 'failed' && evt.attemptData) {
          events.push({ type: 'retry_failed', finalAttempt: evt.attemptData })
        }
        return events
      }
      default:
        return []
    }
  }

  // sdk_message → 转换为对应的 AgentEvent
  const msg = payload.message

  switch (msg.type) {
    case 'assistant': {
      const aMsg = msg as SDKAssistantMessage
      if (aMsg.isReplay) return []
      if (aMsg.error) {
        // 错误已在主进程处理，这里仅作为 typed_error 透传
        return [{ type: 'error', message: aMsg.error.message }]
      }
      const events: AgentEvent[] = []
      for (const block of aMsg.message.content) {
        if (block.type === 'text' && 'text' in block) {
          events.push({ type: 'text_complete', text: (block as { text: string }).text, isIntermediate: false, parentToolUseId: aMsg.parent_tool_use_id ?? undefined })
        } else if (block.type === 'tool_use') {
          const tb = block as SDKContentBlock & { id: string; name: string; input: Record<string, unknown> }
          const intent = (tb.input._intent as string | undefined)
            ?? (tb.name === 'Bash' ? (tb.input.description as string | undefined) : undefined)
          events.push({
            type: 'tool_start',
            toolName: tb.name,
            toolUseId: tb.id,
            input: tb.input,
            intent,
            displayName: tb.input._displayName as string | undefined,
            parentToolUseId: aMsg.parent_tool_use_id ?? undefined,
          })
        }
      }
      // Usage（保留完整字段用于详细展示）
      if (!aMsg.parent_tool_use_id && aMsg.message.usage) {
        const u = aMsg.message.usage
        const inputTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        events.push({
          type: 'usage_update',
          usage: {
            inputTokens,
            outputTokens: u.output_tokens,
            cacheReadTokens: u.cache_read_input_tokens,
            cacheCreationTokens: u.cache_creation_input_tokens,
          },
        })
      }
      return events
    }

    case 'user': {
      const uMsg = msg as SDKUserMessage
      if (uMsg.isReplay) return []
      const events: AgentEvent[] = []
      const contentBlocks = uMsg.message?.content ?? []
      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const tb = block as SDKUserContentBlock & { tool_use_id: string; content?: unknown; is_error?: boolean }
          const resultStr = typeof tb.content === 'string' ? tb.content : (tb.content != null ? JSON.stringify(tb.content) : '')
          events.push({
            type: 'tool_result',
            toolUseId: tb.tool_use_id,
            result: resultStr,
            isError: tb.is_error ?? false,
            parentToolUseId: uMsg.parent_tool_use_id ?? undefined,
          })
        }
      }
      return events
    }

    case 'result': {
      const rMsg = msg as { subtype: string; usage?: { input_tokens: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; total_cost_usd?: number; modelUsage?: Record<string, { contextWindow?: number }> }
      const usage = rMsg.usage
      const contextWindow = rMsg.modelUsage ? Object.values(rMsg.modelUsage)[0]?.contextWindow : undefined
      return [{
        type: 'complete',
        stopReason: rMsg.subtype === 'success' ? 'end_turn' : 'error',
        usage: usage ? {
          inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
          costUsd: rMsg.total_cost_usd,
          contextWindow,
        } : undefined,
      }]
    }

    case 'system': {
      const sMsg = msg as SDKSystemMessage
      if (sMsg.subtype === 'compact_boundary') return [{ type: 'compact_complete' }]
      if (sMsg.subtype === 'compacting') return [{ type: 'compacting' }]
      if (sMsg.subtype === 'task_started' && sMsg.task_id) {
        return [{ type: 'task_started', taskId: sMsg.task_id, description: sMsg.description ?? '', taskType: sMsg.task_type, toolUseId: sMsg.tool_use_id }]
      }
      if (sMsg.subtype === 'task_notification' && sMsg.task_id) {
        return [{
          type: 'task_notification',
          taskId: sMsg.task_id,
          status: (sMsg.status as 'completed' | 'failed' | 'stopped') ?? 'completed',
          summary: sMsg.summary ?? '',
          outputFile: sMsg.output_file,
          toolUseId: sMsg.tool_use_id,
          usage: sMsg.usage ? {
            totalTokens: sMsg.usage.total_tokens ?? 0,
            toolUses: sMsg.usage.tool_uses ?? 0,
            durationMs: sMsg.usage.duration_ms ?? 0,
          } : undefined,
        }]
      }
      if (sMsg.subtype === 'task_progress' && sMsg.task_id) {
        return [{
          type: 'task_progress',
          taskId: sMsg.task_id,
          toolUseId: sMsg.tool_use_id ?? sMsg.task_id,
          description: sMsg.description,
          lastToolName: sMsg.last_tool_name,
          usage: sMsg.usage ? {
            totalTokens: sMsg.usage.total_tokens ?? 0,
            toolUses: sMsg.usage.tool_uses ?? 0,
            durationMs: sMsg.usage.duration_ms ?? 0,
          } : undefined,
        }]
      }
      return []
    }

    case 'tool_progress': {
      const tpMsg = msg as { tool_use_id: string; elapsed_time_seconds?: number; task_id?: string }
      return [{
        type: 'task_progress',
        toolUseId: tpMsg.tool_use_id,
        elapsedSeconds: tpMsg.elapsed_time_seconds,
        taskId: tpMsg.task_id,
      }]
    }

    case 'prompt_suggestion': {
      const psMsg = msg as { suggestion?: string }
      if (psMsg.suggestion) return [{ type: 'prompt_suggestion', suggestion: psMsg.suggestion }]
      return []
    }

    case 'tool_use_summary': {
      const tusMsg = msg as { summary?: string; preceding_tool_use_ids?: string[] }
      if (tusMsg.summary) return [{ type: 'tool_use_summary', summary: tusMsg.summary, precedingToolUseIds: tusMsg.preceding_tool_use_ids ?? [] }]
      return []
    }

    default:
      return []
  }
}

export function useGlobalAgentListeners(): void {
  const store = useStore()

  useEffect(() => {
    // ===== 0. 初始化：从持久化 meta 恢复 stoppedByUser 状态 =====
    window.electronAPI.listAgentSessions().then((sessions) => {
      const stoppedIds = new Set<string>(
        sessions.filter((s) => s.stoppedByUser).map((s) => s.id)
      )
      if (stoppedIds.size > 0) {
        store.set(stoppedByUserSessionsAtom, stoppedIds)
      }
    }).catch(console.error)

    // ===== 1. 流式事件 =====
    const cleanupEvent = window.electronAPI.onAgentStreamEvent(
      (streamEvent: AgentStreamEvent) => {
        const { sessionId, payload } = streamEvent

        // Phase 2: 直接累积 SDKMessage 到 liveMessagesMapAtom（跳过 replay 消息，避免与持久化消息重复）
        if (payload.kind === 'sdk_message') {
          const msgRecord = payload.message as Record<string, unknown>
          if (!msgRecord.isReplay) {
            // 为实时消息补充 _createdAt 时间戳（与持久化时的逻辑一致），
            // 避免 AssistantTurnRenderer 因缺少时间戳导致 header 时间消失
            if (typeof msgRecord._createdAt !== 'number') {
              msgRecord._createdAt = Date.now()
            }

            store.set(liveMessagesMapAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []

              // UUID 去重：队列消息已被乐观注入，SDK 再次推送时跳过
              const incomingUuid = msgRecord.uuid as string | undefined
              if (incomingUuid && current.some((m) => (m as Record<string, unknown>).uuid === incomingUuid)) {
                return prev
              }

              map.set(sessionId, [...current, payload.message])
              return map
            })
          }
        }

        // Phase 1 兼容：将新 AgentStreamPayload 转换为旧 AgentEvent[]
        const legacyEvents = payloadToLegacyEvents(payload)

        for (const event of legacyEvents) {
          // 更新流式状态
          store.set(agentStreamingStatesAtom, (prev) => {
            const current: AgentStreamState = prev.get(sessionId) ?? {
              running: true,
              content: '',
              toolActivities: [],
              teammates: [],
              model: undefined,
              startedAt: Date.now(),
            }
            const next = applyAgentEvent(current, event)
            const map = new Map(prev)
            map.set(sessionId, next)
            return map
          })

          // 自动打开侧面板：检测到 Agent/Task 工具启动或 teammate 任务开始时
          if (
            (event.type === 'tool_start' && (event.toolName === 'Agent' || event.toolName === 'Task')) ||
            event.type === 'task_started'
          ) {
            store.set(agentSidePanelOpenMapAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, true)
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
                  ? { ...t, elapsedSeconds: event.elapsedSeconds ?? t.elapsedSeconds }
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
          } else if (event.type === 'exit_plan_mode_request') {
            // ExitPlanMode 请求入队
            store.set(allPendingExitPlanRequestsAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              map.set(sessionId, [...current, event.request])
              return map
            })
            // 退出 Plan 模式指示状态
            store.set(agentPlanModeSessionsAtom, (prev: Set<string>) => {
              if (!prev.has(sessionId)) return prev
              const next = new Set(prev)
              next.delete(sessionId)
              return next
            })
            // 桌面通知
            const enabled = store.get(notificationsEnabledAtom)
            sendDesktopNotification(
              'Agent 计划待审批',
              'Agent 已完成计划，等待你的审批',
              enabled
            )
          } else if (event.type === 'enter_plan_mode') {
            // 进入 Plan 模式
            store.set(agentPlanModeSessionsAtom, (prev: Set<string>) => {
              if (prev.has(sessionId)) return prev
              const next = new Set(prev)
              next.add(sessionId)
              return next
            })
            // 同步更新权限模式选择器（per-session）
            store.set(agentPermissionModeMapAtom, (prev: Map<string, import('@proma/shared').PromaPermissionMode>) => {
              const next = new Map(prev)
              next.set(sessionId, 'plan')
              return next
            })
          } else if (event.type === 'permission_mode_changed') {
            // 权限模式变更（如 Plan 模式退出时切换到完全自动）
            console.log(`[GlobalAgentListeners] 权限模式变更: ${event.mode}`)
            store.set(agentPermissionModeMapAtom, (prev: Map<string, import('@proma/shared').PromaPermissionMode>) => {
              const next = new Map(prev)
              next.set(sessionId, event.mode)
              return next
            })
          }
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
        // 同时将所有未完成的工具活动标记为已完成，防止 subagent spinner 继续转动
        // （complete 事件只清除 retrying，保持 running: true 以防竞态）
        store.set(agentStreamingStatesAtom, (prev) => {
          const current = prev.get(data.sessionId)
          if (!current || !current.running) return prev
          const map = new Map(prev)
          map.set(data.sessionId, {
            ...current,
            running: false,
            ...finalizeStreamingActivities(current.toolActivities, current.teammates),
          })
          return map
        })

        // 标记用户主动打断状态
        if (data.stoppedByUser) {
          store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
            const next = new Set(prev)
            next.add(data.sessionId)
            return next
          })
        }

        // 清除 Plan 模式状态（防止异常退出时残留）
        store.set(agentPlanModeSessionsAtom, (prev: Set<string>) => {
          if (!prev.has(data.sessionId)) return prev
          const next = new Set(prev)
          next.delete(data.sessionId)
          return next
        })

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

          // 注意：liveMessages 的清理已移至 AgentView 消息加载完成后执行，
          // 与 streamingState 清理同步，避免「实时消息已清 → 持久化消息未到」的空档闪烁

          // 刷新会话列表并同步 stoppedByUser 状态
          window.electronAPI
            .listAgentSessions()
            .then((sessions) => {
              store.set(agentSessionsAtom, sessions)
              // 从持久化 meta 对齐 stoppedByUser 状态
              store.set(stoppedByUserSessionsAtom, new Set<string>(
                sessions.filter((s) => s.stoppedByUser).map((s) => s.id)
              ))
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
