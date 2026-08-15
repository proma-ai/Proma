/**
 * useGlobalAgentListeners — 全局 Agent IPC 监听器
 *
 * 在应用顶层挂载，永不销毁。将所有 Agent 流式事件、
 * 权限请求、AskUser 请求写入对应 Jotai atoms。
 *
 * 使用 useStore() 直接操作 atoms，避免 React 订阅。
 */

import { useEffect } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { useStore } from 'jotai'
import {
  agentStreamingStatesAtom,
  agentStreamErrorsAtom,
  agentSessionMessageQueueAtom,
  agentSessionsAtom,
  agentMessageRefreshAtom,
  allPendingPermissionRequestsAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
  agentPromptSuggestionsAtom,
  agentPendingPromptAtom,
  backgroundTasksAtomFamily,
  recentlyModifiedPathsAtom,
  RECENTLY_MODIFIED_TTL_MS,
  applyAgentLiveUpdate,
  clearAgentStreamError,
  isRetryEventForCurrentStream,
  liveMessagesMapAtom,
  agentSessionModelMapAtom,
  agentSessionChannelMapAtom,
  agentModelIdAtom,
  agentChannelIdAtom,
  agentPermissionModeMapAtom,
  agentDefaultPermissionModeAtom,
  stoppedByUserSessionsAtom,
  agentPlanModeSessionsAtom,
  finalizeStreamingActivities,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  workspaceAttachedFilesMapAtom,
  unviewedCompletedSessionIdsAtom,
  agentSessionPathMapAtom,
  agentDiffRefreshVersionAtom,
  agentDiffPanelTabAtom,
  agentNonGitFileChangesAtom,
  agentFileChangesCurrentRunAtom,
  agentSidePanelOpenAtom,
  askUserDraftsAtom,
} from '@/atoms/agent-atoms'
import {
  notificationsEnabledAtom,
  notificationSoundEnabledAtom,
  notificationSoundsAtom,
  sendDesktopNotification,
  playNotificationSoundForType,
} from '@/atoms/notifications'
import { appModeAtom } from '@/atoms/app-mode'
import { tabsAtom, activeTabIdAtom, activeSessionIdAtom, openTab, updateTabTitle } from '@/atoms/tab-atoms'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import { agentDiffUnseenChangesAtom, agentDiffUnseenFilesAtom } from '@/atoms/agent-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import { previewFileMapAtom } from '@/atoms/preview-atoms'
import type { NotificationSoundType } from '@/types/settings'
import { toast } from 'sonner'
import type { AgentStreamEvent, AgentStreamCompletePayload, AgentStreamErrorPayload, SDKMessage, PromaEvent, AgentSessionMeta, ProviderType } from '@proma/shared'
import { buildExternalAgentRunActivation, buildExternalAgentRunUserMessage, shouldActivateExternalAgentRun } from '@/lib/external-agent-run'
import { mergeActiveAgentSessions, upsertAgentSession } from '@/lib/agent-session-list'
import {
  getAgentCompletionMarkers,
  notifyAgentCompletion,
} from '@/lib/agent-completion-presence'
import { updatePlanModeSessionSet } from '@/lib/agent-plan-mode'
import { buildTodoAgentPrompt } from '@/lib/todo-agent-prompt'
import { detectIsWindows } from '@/lib/platform'
import { getSessionFileChangeKind, arePathsEqual, isPathWithinRoot, upsertSessionFileChange } from '@/lib/session-file-changes'
import { buildQueuedMessageSendPayload, removeQueuedMessage, restoreQueuedMessageToFront, shouldAutoDispatchQueuedMessage, upsertAgentLiveMessageByUuid } from '@/lib/agent-message-queue'
import { buildQuotedSelectionBlock } from '@/lib/quoted-selection'
import { agentLiveTranscriptStore } from '@/lib/agent-live-transcript-store'
import { claimFinalToolSideEffects, isAgentRunSignalForCurrent, isRunScopedRetryUpdate, projectAgentLiveUpdates, shouldAcceptAgentRunStart } from '@/lib/agent-canonical-stream'

/** 触发右侧文件浏览器自动定位的写入类工具集合 */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Update'])

/** 会改变 git 工作树状态的子命令（用于识别 Bash 中触发 diff 刷新的 git 操作） */
const GIT_MUTATING_SUBCOMMANDS = /\bgit\s+(commit|checkout|reset|restore|stash|clean|add|rm|mv|pull|merge|rebase|cherry-pick|revert|switch|am|apply)\b/

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function getParentDir(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return ''
  return normalized.slice(0, idx)
}

/** cyrb53: 快速字符串 hash，遍历完整内容避免边缘碰撞 */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

function uniqueTruthyPaths(paths: Array<string | null | undefined>): string[] {
  return Array.from(new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0)))
}

export function useGlobalAgentListeners(): void {
  const store = useStore()

  useEffect(() => {
    // 所有 active scope 刷新统一保留仍被 Tab 引用的归档 metadata。
    const mergeActiveSnapshot = (active: import('@proma/shared').AgentSessionMeta[]): void => {
      const openSessionIds = new Set(
        store.get(tabsAtom)
          .filter((tab) => tab.type === 'agent' || tab.type === 'preview')
          .map((tab) => tab.sessionId),
      )
      store.set(agentSessionsAtom, (previous) => mergeActiveAgentSessions(previous, active, openSessionIds))
    }

    /** 正在执行的写工具；写入前的文件存在性用于区分新建和编辑。 */
    const pendingWriteTools = new Map<string, {
      path: string
      sessionId: string
      toolName: string
      existedBefore?: boolean
      runId: string
    }>()
    /** 每轮只自动打开一次文件改动面板，避免连续写入打断用户。 */
    const autoActivatedChangeTurns = new Map<string, string>()
    /** 正在执行的 git 突变 Bash 命令：toolUseId → sessionId（完成后触发 diff 刷新） */
    const pendingGitMutateTools = new Map<string, string>()
    /** 依赖完整参数的工具副作用按 final tool_use 去重，partial 只更新工具卡片。 */
    const claimedToolSideEffectsBySession = new Map<string, Set<string>>()
    const clearStartedTools = (sessionId: string): void => {
      claimedToolSideEffectsBySession.delete(sessionId)
    }

    const queuedDispatchInFlight = new Set<string>()
    const queuedDispatchScheduled = new Set<string>()
    // IPC 拒绝后保留失败的队首，直到用户调整队列，避免订阅回调触发自动重试风暴。
    const queuedDispatchSuppressedMessageIds = new Map<string, string>()

    const dispatchQueuedMessage = (sessionId: string): void => {
      if (queuedDispatchInFlight.has(sessionId)) return

      const queuedMessages = store.get(agentSessionMessageQueueAtom).get(sessionId) ?? []
      if (queuedDispatchSuppressedMessageIds.get(sessionId) === queuedMessages[0]?.id) return
      queuedDispatchSuppressedMessageIds.delete(sessionId)
      const streamState = store.get(agentStreamingStatesAtom).get(sessionId)
      const session = store.get(agentSessionsAtom).find((item) => item.id === sessionId)
      if (session?.legacyTranscript?.continuationRequired) return

      const channelId = session?.channelId
        ?? store.get(agentSessionChannelMapAtom).get(sessionId)
        ?? store.get(agentChannelIdAtom)
      const modelId = session?.modelId
        ?? store.get(agentSessionModelMapAtom).get(sessionId)
        ?? store.get(agentModelIdAtom)
      const channels = store.get(channelsAtom)
      const hasAvailableModel = channels.some((channel) => (
        channel.enabled && channel.models.some((model) => model.enabled)
      ))
      const hasBlockingRequests =
        (store.get(allPendingPermissionRequestsAtom).get(sessionId)?.length ?? 0) > 0 ||
        (store.get(allPendingAskUserRequestsAtom).get(sessionId)?.length ?? 0) > 0 ||
        (store.get(allPendingExitPlanRequestsAtom).get(sessionId)?.length ?? 0) > 0

      if (!shouldAutoDispatchQueuedMessage({
        queueLength: queuedMessages.length,
        running: streamState?.running ?? false,
        backgroundWaiting: streamState?.backgroundWaiting ?? false,
        stoppedByUser: store.get(stoppedByUserSessionsAtom).has(sessionId),
        hasBlockingRequests,
        hasChannel: Boolean(channelId),
        hasAvailableModel,
      })) {
        return
      }

      const message = queuedMessages[0]
      if (!message || !channelId) return

      const streamStartedAt = Date.now()
      const quotedSelectionBlock = message.quotedSelection
        ? buildQuotedSelectionBlock(message.quotedSelection)
        : ''
      const payload = buildQueuedMessageSendPayload(message, quotedSelectionBlock)
      let dequeued = false
      queuedDispatchInFlight.add(sessionId)
      store.set(agentSessionMessageQueueAtom, (prev) => {
        const current = prev.get(sessionId) ?? []
        if (current[0]?.id !== message.id) return prev
        const map = new Map(prev)
        const next = removeQueuedMessage(current, message.id)
        if (next.length === 0) map.delete(sessionId)
        else map.set(sessionId, next)
        dequeued = true
        return map
      })
      if (!dequeued) {
        queuedDispatchInFlight.delete(sessionId)
        return
      }

      const optimisticMessageUuid = message.id
      const optimisticMessage: SDKMessage = {
        type: 'user',
        uuid: optimisticMessageUuid,
        message: { content: [{ type: 'text', text: payload.rawText }] },
        parent_tool_use_id: null,
        _createdAt: streamStartedAt,
        _promaLiveRunStartedAt: streamStartedAt,
      } as unknown as SDKMessage
      store.set(liveMessagesMapAtom, (prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        map.set(sessionId, upsertAgentLiveMessageByUuid(current, optimisticMessage))
        return map
      })
      store.set(agentStreamErrorsAtom, (prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
      store.set(agentStreamingStatesAtom, (prev) => {
        const map = new Map(prev)
        map.set(sessionId, {
          running: true,
          toolActivities: [],
          model: modelId || undefined,
          startedAt: streamStartedAt,
          inputTokens: prev.get(sessionId)?.inputTokens,
          contextWindow: prev.get(sessionId)?.contextWindow,
        })
        return map
      })

      const rollbackFailedDispatch = (): void => {
        queuedDispatchSuppressedMessageIds.set(sessionId, message.id)
        store.set(agentSessionMessageQueueAtom, (prev) => {
          const map = new Map(prev)
          map.set(sessionId, restoreQueuedMessageToFront(map.get(sessionId) ?? [], message))
          return map
        })
        store.set(liveMessagesMapAtom, (prev) => {
          const current = prev.get(sessionId) ?? []
          const next = current.filter((item) => (item as unknown as { uuid?: string }).uuid !== optimisticMessageUuid)
          if (next.length === current.length) return prev
          const map = new Map(prev)
          if (next.length === 0) map.delete(sessionId)
          else map.set(sessionId, next)
          return map
        })
        store.set(agentStreamingStatesAtom, (prev) => {
          const current = prev.get(sessionId)
          if (!current || current.startedAt !== streamStartedAt) return prev
          const map = new Map(prev)
          map.set(sessionId, { ...current, running: false })
          return map
        })
      }

      const queuedAdditionalDirectories = message.additionalDirectories ?? []
      const workspaceId = session?.workspaceId ?? store.get(currentAgentWorkspaceIdAtom) ?? undefined
      const attachedDirectories = store.get(agentAttachedDirectoriesMapAtom).get(sessionId)
        ?? session?.attachedDirectories
        ?? []
      const attachedFiles = store.get(agentAttachedFilesMapAtom).get(sessionId)
        ?? session?.attachedFiles
        ?? []
      const workspaceAttachedFiles = workspaceId
        ? (store.get(workspaceAttachedFilesMapAtom).get(workspaceId) ?? [])
        : []
      const additionalDirectories = Array.from(new Set([
        ...attachedDirectories,
        ...[...attachedFiles, ...workspaceAttachedFiles].map(getParentDir).filter(Boolean),
        ...queuedAdditionalDirectories,
      ]))
      const permissionMode = store.get(agentPermissionModeMapAtom).get(sessionId)
        ?? session?.permissionMode
        ?? store.get(agentDefaultPermissionModeAtom)

      try {
        const sendPromise = window.electronAPI.sendAgentMessage({
          sessionId,
          userMessage: payload.sdkText,
          rawUserMessage: payload.rawText,
          channelId,
          modelId: modelId || undefined,
          workspaceId,
          startedAt: streamStartedAt,
          permissionModeOverride: permissionMode,
          ...(additionalDirectories.length > 0 && { additionalDirectories }),
          ...(payload.mentions.mentionedSkills.length > 0 && { mentionedSkills: payload.mentions.mentionedSkills }),
          ...(payload.mentions.mentionedMcpServers.length > 0 && { mentionedMcpServers: payload.mentions.mentionedMcpServers }),
          ...(payload.mentions.mentionedSessionIds.length > 0 && { mentionedSessionIds: payload.mentions.mentionedSessionIds }),
          ...(payload.mentions.mentionedTodoIds.length > 0 && { mentionedTodoIds: payload.mentions.mentionedTodoIds }),
          ...(payload.mentions.mentionedCalendarEventIds.length > 0 && { mentionedCalendarEventIds: payload.mentions.mentionedCalendarEventIds }),
        })
        queuedDispatchInFlight.delete(sessionId)
        void sendPromise.catch((error) => {
          console.error('[GlobalAgentListeners] 自动发送队列消息失败:', error)
          rollbackFailedDispatch()
          toast.error('自动发送队列消息失败', { description: String(error) })
        })
      } catch (error) {
        queuedDispatchInFlight.delete(sessionId)
        console.error('[GlobalAgentListeners] 自动发送队列消息初始化失败:', error)
        rollbackFailedDispatch()
        toast.error('自动发送队列消息失败', { description: String(error) })
      }
    }

    const scheduleQueuedMessageDispatch = (sessionId: string): void => {
      if (queuedDispatchScheduled.has(sessionId)) return
      queuedDispatchScheduled.add(sessionId)
      queueMicrotask(() => {
        queuedDispatchScheduled.delete(sessionId)
        dispatchQueuedMessage(sessionId)
      })
    }

    const scheduleAllQueuedMessageDispatches = (): void => {
      for (const sessionId of store.get(agentSessionMessageQueueAtom).keys()) {
        scheduleQueuedMessageDispatch(sessionId)
      }
    }

    const queuedDispatchUnsubscribers = [
      store.sub(agentSessionMessageQueueAtom, scheduleAllQueuedMessageDispatches),
      store.sub(agentStreamingStatesAtom, scheduleAllQueuedMessageDispatches),
      store.sub(agentSessionsAtom, scheduleAllQueuedMessageDispatches),
      store.sub(agentSessionChannelMapAtom, scheduleAllQueuedMessageDispatches),
      store.sub(agentChannelIdAtom, scheduleAllQueuedMessageDispatches),
      store.sub(allPendingPermissionRequestsAtom, scheduleAllQueuedMessageDispatches),
      store.sub(allPendingAskUserRequestsAtom, scheduleAllQueuedMessageDispatches),
      store.sub(allPendingExitPlanRequestsAtom, scheduleAllQueuedMessageDispatches),
      store.sub(channelsAtom, scheduleAllQueuedMessageDispatches),
    ]

    /** 构建导航到指定会话的回调 */
    const makeNavigateToSession = (sessionId: string, sessionTitle: string) => () => {
      const tabs = store.get(tabsAtom)
      const result = openTab(tabs, { type: 'agent', sessionId, title: sessionTitle })
      store.set(tabsAtom, result.tabs)
      store.set(activeTabIdAtom, result.activeTabId)
      store.set(appModeAtom, 'agent')
      store.set(currentAgentSessionIdAtom, sessionId)
      const sessions = store.get(agentSessionsAtom)
      const session = sessions.find((s) => s.id === sessionId)
      if (session?.workspaceId) {
        store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
      }
    }

    /** 获取会话标题 */
    const getSessionTitle = (sessionId: string): string => {
      const sessions = store.get(agentSessionsAtom)
      return sessions.find((s) => s.id === sessionId)?.title ?? '未命名会话'
    }

    const activateExternalAgentRun = (event: Extract<PromaEvent, { type: 'external_run_started' }>): void => {
      const applyActivation = (sessions: AgentSessionMeta[]): void => {
        const currentStreamState = store.get(agentStreamingStatesAtom).get(event.sessionId)
        if (!shouldActivateExternalAgentRun(currentStreamState, event.startedAt)) {
          return
        }

        const eventSession = event.session
        const activationSessions = eventSession ? [eventSession] : sessions
        const activation = buildExternalAgentRunActivation({
          tabs: store.get(tabsAtom),
          sessions: activationSessions,
          sessionId: event.sessionId,
          title: event.title,
          workspaceId: event.workspaceId,
          modelId: event.modelId,
          channelId: event.channelId ?? eventSession?.channelId,
          runId: event.runId,
          startedAt: event.startedAt,
          currentStreamState,
        })

        // 外部来源（飞书/钉钉/微信/bridge）唤起的 run 不抢占前台：
        // 不打开新 Tab、不切换激活 Tab、不切换 appMode/当前会话/当前工作区。
        // 只更新驱动左侧边栏列表与状态指示条所需的状态，让用户自行决定是否切过去。
        // 若该会话恰好是用户当前正在查看的会话，这里不动 Tab/激活，流式内容会通过
        // agentStreamingStatesAtom 自然刷新，用户视角无任何跳动。
        // 只 upsert 本次 event 对应的会话，绝不用这份快照整体覆盖列表。
        //
        // 一次派发多个子会话时，多个 external_run_started 回调会各自带着
        // 「事件触发那一刻」或「异步 fetch 那一刻」的快照进来。若整体覆盖
        // agentSessionsAtom，后 resolve 的回调会用自己那份可能缺失了刚结束
        // turn 的父会话的快照，把父会话冲掉——父会话从列表消失后，其子会话
        // 因找不到父而从树形子节点变成根节点直接显示（用户观察到的现象）。
        // 改为单条 upsert 后，每个回调只负责自己那一个会话，互不干扰。
        const sessionMeta = eventSession ?? sessions.find((item) => item.id === event.sessionId)
        const upserted: AgentSessionMeta = sessionMeta ?? {
          id: event.sessionId,
          title: activation.title,
          workspaceId: activation.workspaceId,
          modelId: activation.modelId,
          createdAt: event.startedAt,
          updatedAt: event.startedAt,
        }
        store.set(agentSessionsAtom, (prev) => upsertAgentSession(prev, upserted))
        const activationModelId = activation.modelId
        if (activationModelId) {
          store.set(agentSessionModelMapAtom, (prev) => {
            const map = new Map(prev)
            map.set(event.sessionId, activationModelId)
            return map
          })
        }
        store.set(unviewedCompletedSessionIdsAtom, (prev) => {
          if (!prev.has(event.sessionId)) return prev
          const next = new Set(prev)
          next.delete(event.sessionId)
          return next
        })
        store.set(agentStreamingStatesAtom, (prev) => {
          const map = new Map(prev)
          map.set(event.sessionId, activation.streamState)
          return map
        })
      }

      if (event.session) {
        applyActivation([event.session])
        return
      }

      const knownSessions = store.get(agentSessionsAtom)
      if (knownSessions.some((session) => session.id === event.sessionId)) {
        applyActivation(knownSessions)
        return
      }

      window.electronAPI.listAgentSessions('active')
        .then((sessions) => {
          unstable_batchedUpdates(() => applyActivation(sessions))
        })
        .catch(console.error)
    }

    /** 发送阻塞通知（带提示音 + 会话导航） */
    const sendBlockingNotification = (sessionId: string, title: string, body: string, soundType: NotificationSoundType) => {
      const enabled = store.get(notificationsEnabledAtom)
      const soundEnabled = store.get(notificationSoundEnabledAtom)
      const sounds = store.get(notificationSoundsAtom)
      const sessionTitle = getSessionTitle(sessionId)
      sendDesktopNotification(
        title,
        `[${sessionTitle}] ${body}`,
        enabled,
        {
          force: true,
          playSound: enabled && soundEnabled,
          soundType,
          sounds,
          onNavigate: makeNavigateToSession(sessionId, sessionTitle),
        }
      )
    }

    const workspaceFilesPathCache = new Map<string, string>()

    const getWorkspaceIdForSession = (sid: string): string | null => {
      const session = store.get(agentSessionsAtom).find((s) => s.id === sid)
      return session?.workspaceId ?? store.get(currentAgentWorkspaceIdAtom)
    }

    const getWorkspaceSlugForSession = (sid: string): string | null => {
      const workspaceId = getWorkspaceIdForSession(sid)
      if (!workspaceId) return null
      return store.get(agentWorkspacesAtom).find((w) => w.id === workspaceId)?.slug ?? null
    }

    const getWorkspaceFilesPathForSession = async (sid: string): Promise<string | null> => {
      const slug = getWorkspaceSlugForSession(sid)
      if (!slug) return null
      const cached = workspaceFilesPathCache.get(slug)
      if (cached) return cached
      try {
        const path = await window.electronAPI.getWorkspaceFilesPath(slug)
        workspaceFilesPathCache.set(slug, path)
        return path
      } catch {
        return null
      }
    }

    const getWorkspaceAttachmentsForSession = async (sid: string): Promise<{
      directories: string[]
      files: string[]
      complete: boolean
    }> => {
      const slug = getWorkspaceSlugForSession(sid)
      if (!slug) return { directories: [], files: [], complete: true }
      try {
        const [directories, files] = await Promise.all([
          window.electronAPI.getWorkspaceDirectories(slug),
          window.electronAPI.getWorkspaceAttachedFiles(slug),
        ])
        return { directories, files, complete: true }
      } catch {
        return { directories: [], files: [], complete: false }
      }
    }

    const buildWrittenFilePreviewInfo = async (sid: string, targetPath: string) => {
      const sessionPath = store.get(agentSessionPathMapAtom).get(sid) ?? ''
      const parentDir = getParentDir(targetPath)
      const dirPath = isAbsolutePath(targetPath) ? parentDir : (sessionPath || parentDir)
      const workspaceId = getWorkspaceIdForSession(sid)
      const workspaceFilesPath = await getWorkspaceFilesPathForSession(sid)
      const sessionAttachedDirs = store.get(agentAttachedDirectoriesMapAtom).get(sid) ?? []
      const sessionAttachedFiles = store.get(agentAttachedFilesMapAtom).get(sid) ?? []
      const workspaceAttachedDirs = workspaceId
        ? (store.get(workspaceAttachedDirectoriesMapAtom).get(workspaceId) ?? [])
        : []
      const workspaceAttachedFiles = workspaceId
        ? (store.get(workspaceAttachedFilesMapAtom).get(workspaceId) ?? [])
        : []
      const basePaths = uniqueTruthyPaths([
        sessionPath,
        workspaceFilesPath,
        dirPath,
        ...sessionAttachedDirs,
        ...sessionAttachedFiles,
        ...workspaceAttachedDirs,
        ...workspaceAttachedFiles,
      ])

      let previewOnly = true
      if (dirPath) {
        try {
          const status = await window.electronAPI.getGitRepoStatus(dirPath)
          previewOnly = status?.isRepo !== true
        } catch {
          previewOnly = true
        }
      }

      // 右侧改动面板应记录 Agent 实际写入的所有路径；会话附件只约束初始上下文，
      // 不应让已完成的外部文件操作从用户可见的变更记录中消失。
      return {
        filePath: targetPath,
        dirPath: dirPath || undefined,
        previewOnly,
        basePaths: basePaths.length > 0 ? basePaths : undefined,
      }
    }

    const isWindows = detectIsWindows()

    const cleanupWatchedFileChanges = window.electronAPI.onWorkspaceFilesChanged((changedPaths) => {
      const filePaths = (changedPaths ?? []).filter(isAbsolutePath)
      if (filePaths.length === 0) return

      void (async () => {
        const streamingStates = store.get(agentStreamingStatesAtom)
        const sessionPaths = store.get(agentSessionPathMapAtom)
        const candidateIds = [...streamingStates.entries()]
          .filter(([, state]) => state.running)
          .map(([sessionId]) => sessionId)

        const candidates = await Promise.all(candidateIds.map(async (sessionId) => {
          const session = store.get(agentSessionsAtom).find((item) => item.id === sessionId)
          const sessionPath = sessionPaths.get(sessionId)
          const workspaceFilesPath = await getWorkspaceFilesPathForSession(sessionId)
          const workspaceAttachments = await getWorkspaceAttachmentsForSession(sessionId)
          if (!session || !workspaceAttachments.complete) {
            // 缺少运行会话的权威附件配置时，任何路径都不能安全归属给其他会话。
            return { sessionId, matchingPaths: [...filePaths] }
          }
          const directoryRoots = uniqueTruthyPaths([
            sessionPath,
            workspaceFilesPath,
            ...(session.attachedDirectories ?? []),
            ...workspaceAttachments.directories,
          ])
          const attachedFiles = uniqueTruthyPaths([
            ...(session.attachedFiles ?? []),
            ...workspaceAttachments.files,
          ])
          const matchingPaths = filePaths.filter((changedPath) => (
            directoryRoots.some((rootPath) => isPathWithinRoot(rootPath, changedPath, isWindows))
            || attachedFiles.some((filePath) => arePathsEqual(filePath, changedPath, isWindows))
          ))
          return { sessionId, matchingPaths }
        }))

        for (const { sessionId, matchingPaths } of candidates) {
          // watcher 事件没有来源 session。路径被多个运行中会话覆盖时不能可靠归属，
          // 因此仅记录唯一匹配的路径，避免把后台会话的写入显示在错误会话中。
          const uniquelyMatchingPaths = matchingPaths.filter((changedPath) => (
            candidates.filter((candidate) => candidate.matchingPaths.includes(changedPath)).length === 1
          ))
          if (uniquelyMatchingPaths.length === 0) continue

          const runId = store.get(agentFileChangesCurrentRunAtom).get(sessionId)
            ?? String(streamingStates.get(sessionId)?.startedAt ?? Date.now())
          for (const changedPath of uniquelyMatchingPaths) {
            const previewFile = await buildWrittenFilePreviewInfo(sessionId, changedPath)
            if (!previewFile.previewOnly) continue
            store.set(agentNonGitFileChangesAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              map.set(sessionId, upsertSessionFileChange(current, {
                path: changedPath,
                kind: 'edited',
                runId,
                updatedAt: Date.now(),
              }, isWindows))
              return map
            })
            if (
              store.get(currentAgentSessionIdAtom) === sessionId
              && autoActivatedChangeTurns.get(sessionId) !== runId
            ) {
              autoActivatedChangeTurns.set(sessionId, runId)
              store.set(agentSidePanelOpenAtom, true)
              store.set(agentDiffPanelTabAtom, (prev) => {
                const map = new Map(prev)
                map.set(sessionId, 'changes')
                return map
              })
            }
          }
        }
      })().catch(() => { /* 文件监听不应影响会话流 */ })
    })

    // ===== 0. 初始化：从持久化 meta 恢复 stoppedByUser 状态 =====
    window.electronAPI.listAgentSessions('active').then((sessions) => {
      const stoppedIds = new Set<string>(
        sessions.filter((s) => s.stoppedByUser).map((s) => s.id)
      )
      if (stoppedIds.size > 0) {
        store.set(stoppedByUserSessionsAtom, stoppedIds)
      }
    }).catch(console.error)

    /** 为 renderer 实时消息补齐 UI 所需元数据；canonical reset 与旧 SDKMessage 共用。 */
    const enrichLiveAssistantMessage = (sessionId: string, msgRecord: Record<string, unknown>): void => {
      if (typeof msgRecord._createdAt !== 'number') msgRecord._createdAt = Date.now()

      const activeRunStartedAt = store.get(agentStreamingStatesAtom).get(sessionId)?.startedAt
      if (activeRunStartedAt != null) msgRecord._promaLiveRunStartedAt = activeRunStartedAt

      if (msgRecord.type !== 'assistant') return

      const sessionModelMap = store.get(agentSessionModelMapAtom)
      const sessionChannelMap = store.get(agentSessionChannelMapAtom)
      const defaultModelId = store.get(agentModelIdAtom)
      const defaultChannelId = store.get(agentChannelIdAtom)
      const channelId = sessionChannelMap.get(sessionId) ?? defaultChannelId ?? undefined

      if (!msgRecord._channelModelId) {
        msgRecord._channelModelId = sessionModelMap.get(sessionId) ?? defaultModelId ?? undefined
      }
      if (!msgRecord._channelId && channelId) msgRecord._channelId = channelId
      if (!msgRecord._channelProvider && channelId) {
        const provider = store.get(channelsAtom).find((channel) => channel.id === channelId)?.provider
        if (provider) msgRecord._channelProvider = provider as ProviderType
      }
    }

    // ===== 1. 流式事件 =====
    const lastRunSequenceBySession = new Map<string, { runId: string; sequence: number }>()
    const handleStreamEvent = (streamEvent: AgentStreamEvent): void => {
        unstable_batchedUpdates(() => {
        const { sessionId, payload } = streamEvent
        const runStartEvent = payload.kind === 'proma_event'
          && (payload.event.type === 'run_started' || payload.event.type === 'external_run_started')
          ? payload.event
          : undefined
        const activeState = store.get(agentStreamingStatesAtom).get(sessionId)

        if (runStartEvent && !shouldAcceptAgentRunStart(activeState, runStartEvent)) return

        // 所有 run-scoped 事件都精确匹配 opaque runId；被拒绝的并发 send 不得影响当前 run。
        if (!runStartEvent && streamEvent.runId && activeState?.runId && streamEvent.runId !== activeState.runId) {
          return
        }
        if (streamEvent.runId && streamEvent.sequence != null) {
          const previous = lastRunSequenceBySession.get(sessionId)
          if (previous && previous.runId === streamEvent.runId && streamEvent.sequence <= previous.sequence) return
          lastRunSequenceBySession.set(sessionId, { runId: streamEvent.runId, sequence: streamEvent.sequence })
        }

        if (runStartEvent) {
          const event = runStartEvent
          clearStartedTools(sessionId)
          agentLiveTranscriptStore.clear(sessionId)
          lastRunSequenceBySession.set(sessionId, {
            runId: event.runId,
            sequence: streamEvent.sequence ?? 0,
          })
          store.set(agentStreamingStatesAtom, (prev) => {
            const current = prev.get(sessionId)
            const map = new Map(prev)
            map.set(sessionId, {
              ...(current ?? { running: true, toolActivities: [] }),
              running: true,
              runId: event.runId,
              startedAt: event.startedAt,
            })
            return map
          })

          const optimisticUserMessage = event.type === 'external_run_started'
            ? buildExternalAgentRunUserMessage(event)
            : null
          if (optimisticUserMessage) {
            store.set(liveMessagesMapAtom, (prev) => {
              const current = prev.get(sessionId) ?? []
              const uuid = (optimisticUserMessage as Record<string, unknown>).uuid
              if (current.some((message) => (message as Record<string, unknown>).uuid === uuid)) return prev
              const map = new Map(prev)
              map.set(sessionId, [...current, optimisticUserMessage])
              return map
            })
          }
        }

        let liveUpdates = payload.kind === 'assistant_message_delta'
          ? []
          : projectAgentLiveUpdates(payload)
        if (payload.kind === 'assistant_message_delta') {
          if (payload.reset) {
            enrichLiveAssistantMessage(sessionId, payload.reset as unknown as Record<string, unknown>)
          }
          // assistant delta 在归约正文时同步产出语义更新，避免再次扫描同一份 operations。
          const applied = agentLiveTranscriptStore.applyWithUpdates(sessionId, payload)
          if (!applied) return
          liveUpdates = applied.updates
        }

        if (payload.kind === 'proma_event' && payload.event.type === 'external_run_started') {
          activateExternalAgentRun(payload.event)
        }

        // 自动任务会话被用户接管（毕业）：向用户提示，后续定时运行将新建独立会话
        if (payload.kind === 'proma_event' && payload.event.type === 'automation_graduated') {
          toast('已接管自动任务会话，后续定时运行将创建新会话。', { duration: 3000 })
          window.electronAPI.listAgentSessions('active')
            .then(mergeActiveSnapshot)
            .catch(console.error)
        }


        // 如果收到未知会话的事件（跨工作区场景），立即刷新会话列表
        const knownSessions = store.get(agentSessionsAtom)
        if (!knownSessions.some((s) => s.id === sessionId)) {
          window.electronAPI.listAgentSessions('active')
            .then(mergeActiveSnapshot)
            .catch(console.error)
        }

        // final/control SDKMessage 进入 live transcript；assistant partial 由 external store 独立维护。
        if (payload.kind === 'sdk_message') {
          const msgRecord = payload.message as Record<string, unknown>
          if (msgRecord.type === 'assistant') {
            const messageId = typeof msgRecord.uuid === 'string'
              ? msgRecord.uuid
              : `assistant:${sessionId}`
            agentLiveTranscriptStore.finalize(sessionId, messageId)
          }
          // prompt_suggestion 不是对话转录消息，通过 canonical live projection 写入输入区 atom。
          if (msgRecord.type === 'prompt_suggestion') {
            // 跳过写入 liveMessages
          } else if (msgRecord.type === 'system' && msgRecord.subtype === 'thinking_tokens') {
            // thinking_tokens 是高频进度估算，只更新流式状态，不进入消息转录。
          } else if (!msgRecord.isReplay) {
            enrichLiveAssistantMessage(sessionId, msgRecord)

            store.set(liveMessagesMapAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []

              // UUID 去重：队列用户消息已被乐观注入；assistant 这里只接收稳定 final。
              const incomingUuid = msgRecord.uuid as string | undefined
              if (incomingUuid) {
                const duplicateIndex = current.findIndex((message) =>
                  (message as Record<string, unknown>).uuid === incomingUuid
                )
                if (duplicateIndex >= 0) {
                  // Pi 已实际消费 queued user 时，即使前一 assistant 没有 stable final，也要解除
                  // 临时 tail marker，避免异常终态清空 preview 后用户消息短暂消失。
                  if (msgRecord.type === 'user' && msgRecord._promaQueuedBoundary === true) {
                    const resolvedBoundary = {
                      ...(current[duplicateIndex] as unknown as Record<string, unknown>),
                    }
                    delete resolvedBoundary._promaPendingAfterLiveAssistant
                    const next = [...current]
                    next[duplicateIndex] = resolvedBoundary as unknown as SDKMessage
                    map.set(sessionId, next)
                    return map
                  }
                  return prev
                }
              }

              if (msgRecord.type === 'assistant') {
                const pendingBoundaryIndex = current.findIndex((message) =>
                  (message as Record<string, unknown>)._promaPendingAfterLiveAssistant === true
                )
                if (pendingBoundaryIndex >= 0) {
                  const pendingBoundary = current[pendingBoundaryIndex] as unknown as Record<string, unknown>
                  const resolvedBoundary = { ...pendingBoundary }
                  delete resolvedBoundary._promaPendingAfterLiveAssistant
                  map.set(sessionId, [
                    ...current.slice(0, pendingBoundaryIndex),
                    payload.message,
                    resolvedBoundary as unknown as SDKMessage,
                    ...current.slice(pendingBoundaryIndex + 1),
                  ])
                  return map
                }
              }

              map.set(sessionId, [...current, payload.message])
              return map
            })
          }
        }

        // canonical payload 直接投影为 UI 状态更新；assistant partial 已在正文归约时同步生成投影。

        for (const event of liveUpdates) {
          // 带 run 标识的 retry 更新必须在所有外围副作用前严格匹配当前流；
          // 否则迟到 IPC 会复活已结束的 stream，或错误清掉新 run 的完成提醒。
          const eventStreamState = store.get(agentStreamingStatesAtom).get(sessionId)
          if (isRunScopedRetryUpdate(event) && event.runStartedAt != null && (
            !eventStreamState || !isRetryEventForCurrentStream(eventStreamState, event)
          )) {
            continue
          }

          const shouldRunToolSideEffects = claimFinalToolSideEffects(
            claimedToolSideEffectsBySession,
            sessionId,
            event,
          )

          // 会话首次进入 running 时，清除旧的完成提醒状态
          if (event.type !== 'prompt_suggestion') {
            const prevState = store.get(agentStreamingStatesAtom).get(sessionId)
            if (!prevState || !prevState.running) {
              store.set(unviewedCompletedSessionIdsAtom, (prev: Set<string>) => {
                if (!prev.has(sessionId)) return prev
                const next = new Set(prev)
                next.delete(sessionId)
                return next
              })
            }
          }

          // 更新流式状态（prompt_suggestion 不影响流式状态，跳过以避免在 session 结束后用默认值 running:true 重新激活）
          if (event.type !== 'prompt_suggestion') {
            store.set(agentStreamingStatesAtom, (prev) => {
              const existing = prev.get(sessionId)
              // 再做一次 scope 校验，防止同一 batch 内其它回调更新流状态后旧事件落入。
              if (isRunScopedRetryUpdate(event) && event.runStartedAt != null && (
                !existing || !isRetryEventForCurrentStream(existing, event)
              )) {
                return prev
              }
              const current: AgentStreamState = existing ?? {
                running: true,
                      toolActivities: [],
                model: undefined,
                // retry 带 run 标识时必须先匹配已有状态，不允许在这里凭空创建 run scope。
                startedAt: undefined,
              }
              const next = applyAgentLiveUpdate(current, event)
              if (next === current) return prev
              const map = new Map(prev)
              map.set(sessionId, next)
              return map
            })
          }

          const activeRunStartedAt = store.get(agentStreamingStatesAtom).get(sessionId)?.startedAt
          if (activeRunStartedAt != null) {
            const activeRunId = String(activeRunStartedAt)
            store.set(agentFileChangesCurrentRunAtom, (prev) => {
              if (prev.get(sessionId) === activeRunId) return prev
              const map = new Map(prev)
              map.set(sessionId, activeRunId)
              return map
            })
          }

          // Pi 原生重试成功后仍会沿用同一会话；仅在事件属于当前 stream run 时
          // 清掉过期错误，避免迟到的旧 retry_cleared 掩盖新一轮真实失败。
          if (event.type === 'retry_cleared') {
            const current = store.get(agentStreamingStatesAtom).get(sessionId)
            if (current && isRetryEventForCurrentStream(current, event)) {
              store.set(agentStreamErrorsAtom, (prev) => clearAgentStreamError(prev, sessionId))
            }
          }

          // 非 Git 文件写入时自动打开“文件改动”；Git Diff 的面板状态仍由用户控制。

          // Agent 修改文件时，记入「最近修改」状态，用于 60s 内左侧竖条标记
          if (event.type === 'tool_start' && shouldRunToolSideEffects && WRITE_TOOLS.has(event.toolName)) {
            const input = event.input as Record<string, unknown> | undefined
            const targetPath =
              (input?.file_path as string | undefined)
              ?? (input?.path as string | undefined)
              ?? (input?.notebook_path as string | undefined)
            const runId = store.get(agentFileChangesCurrentRunAtom).get(sessionId)
              ?? String(store.get(agentStreamingStatesAtom).get(sessionId)?.startedAt ?? Date.now())
            const entry = {
              path: targetPath || '',
              sessionId,
              toolName: event.toolName,
              runId,
            }
            pendingWriteTools.set(event.toolUseId, entry)
            if (typeof targetPath === 'string' && targetPath.length > 0) {
              void window.electronAPI.resolveAndReadFile(targetPath, { sessionId })
                .then((file) => {
                  const pending = pendingWriteTools.get(event.toolUseId)
                  if (pending) pending.existedBefore = file !== null
                })
                .catch(() => {
                  // 文件不存在和暂时无法读取都按未知处理，避免阻断写入反馈。
                })
            }
            if (typeof targetPath === 'string' && targetPath.length > 0) {
              const now = Date.now()
              // 记入「最近修改」状态，用于 60s 内左侧竖条标记
              store.set(recentlyModifiedPathsAtom, (prev) => {
                const map = new Map(prev)
                const inner = new Map(map.get(sessionId) ?? new Map())
                inner.set(targetPath, now)
                map.set(sessionId, inner)
                return map
              })
            }
          }

          // Bash 工具执行 git 突变命令时，标记为待刷新（完成后刷新 diff 列表）
          if (event.type === 'tool_start' && shouldRunToolSideEffects && event.toolName === 'Bash') {
            const input = event.input as Record<string, unknown> | undefined
            const command = typeof input?.command === 'string' ? input.command : ''
            if (command && GIT_MUTATING_SUBCOMMANDS.test(command)) {
              pendingGitMutateTools.set(event.toolUseId, sessionId)
            }
          }

          if (event.type === 'task_progress') {
            store.set(backgroundTasksAtomFamily(sessionId), (prev) =>
              prev.map((t) =>
                t.toolUseId === event.toolUseId
                  ? { ...t, elapsedSeconds: event.elapsedSeconds ?? t.elapsedSeconds }
                  : t
              )
            )
          } else if (event.type === 'tool_result') {
            // 工具完成时，移除对应的后台任务
            store.set(backgroundTasksAtomFamily(sessionId), (prev) =>
              prev.filter((t) => t.toolUseId !== event.toolUseId)
            )
            // Agent 写类工具成功时刷新 Git diff；非 Git 目录记录为本会话文件变更。
            if (pendingWriteTools.has(event.toolUseId)) {
              const entry = pendingWriteTools.get(event.toolUseId)!
              const writtenPath = entry.path
              pendingWriteTools.delete(event.toolUseId)
              if (event.isError) continue
              // 相对路径的 cwd 由 Agent 决定，不能按 Electron cwd 错配到别的仓库；改为保守全量失效。
              const cacheInvalidationPath = writtenPath && isAbsolutePath(writtenPath) ? writtenPath : undefined
              void window.electronAPI.invalidateGitDiffCache(cacheInvalidationPath).finally(() => {
                store.set(agentDiffRefreshVersionAtom, (prev) => {
                  const m = new Map(prev); m.set(sessionId, (prev.get(sessionId) ?? 0) + 1); return m
                })
              })
              if (writtenPath) {
                buildWrittenFilePreviewInfo(sessionId, writtenPath).then((previewFile) => {
                  if (!previewFile) return

                  store.set(agentDiffUnseenChangesAtom, (prev) => {
                    const m = new Map(prev); m.set(sessionId, true); return m
                  })
                  store.set(agentDiffUnseenFilesAtom, (prev) => {
                    const m = new Map(prev)
                    const s = new Set(m.get(sessionId) ?? [])
                    s.add(writtenPath)
                    m.set(sessionId, s)
                    return m
                  })

                  if (previewFile.previewOnly) {
                    store.set(agentNonGitFileChangesAtom, (prev) => {
                      const m = new Map(prev)
                      const current = m.get(sessionId) ?? []
                      m.set(sessionId, upsertSessionFileChange(current, {
                        path: writtenPath,
                        kind: getSessionFileChangeKind(entry.toolName, entry.existedBefore),
                        runId: entry.runId,
                        updatedAt: Date.now(),
                      }, isWindows))
                      return m
                    })

                    if (
                      store.get(currentAgentSessionIdAtom) === sessionId
                      && autoActivatedChangeTurns.get(sessionId) !== entry.runId
                    ) {
                      autoActivatedChangeTurns.set(sessionId, entry.runId)
                      store.set(agentSidePanelOpenAtom, true)
                      store.set(agentDiffPanelTabAtom, (prev) => {
                        const m = new Map(prev)
                        m.set(sessionId, 'changes')
                        return m
                      })
                    }
                  }

                }).catch(() => { /* 改动提示不应影响流式输出 */ })
              }
            }
            // Bash git 突变命令完成时，仅刷新 diff 列表（不标记 unseen，避免红点）
            if (pendingGitMutateTools.has(event.toolUseId)) {
              pendingGitMutateTools.delete(event.toolUseId)
              void window.electronAPI.invalidateGitDiffCache().finally(() => {
                store.set(agentDiffRefreshVersionAtom, (prev) => {
                  const m = new Map(prev); m.set(sessionId, (prev.get(sessionId) ?? 0) + 1); return m
                })
              })
            }
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
            // 桌面通知（带提示音 + 会话导航）
            sendBlockingNotification(
              sessionId,
              '需要权限确认',
              event.request.toolName
                ? `Agent 请求使用工具: ${event.request.toolName}`
                : 'Agent 需要你的权限确认',
              'permissionRequest'
            )
          } else if (event.type === 'ask_user_request') {
            // AskUser 请求入队（统一通道，不区分当前/后台会话）
            store.set(allPendingAskUserRequestsAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              map.set(sessionId, [...current, event.request])
              return map
            })
            // 桌面通知（带提示音 + 会话导航）
            sendBlockingNotification(
              sessionId,
              'Agent 需要你的输入',
              event.request.questions[0]?.question ?? 'Agent 有问题需要你回答',
              'permissionRequest'
            )
          } else if (event.type === 'ask_user_resolved') {
            // AskUser 可能由协作父会话代答，收到 resolved 后清理所有会话中的残留请求和草稿
            store.set(allPendingAskUserRequestsAtom, (prev) => {
              let changed = false
              const map = new Map(prev)
              prev.forEach((requests, pendingSessionId) => {
                const nextRequests = requests.filter((request) => request.requestId !== event.requestId)
                if (nextRequests.length !== requests.length) changed = true
                if (nextRequests.length === 0) map.delete(pendingSessionId)
                else map.set(pendingSessionId, nextRequests)
              })
              return changed ? map : prev
            })
            store.set(askUserDraftsAtom, (prev) => {
              if (!prev.has(event.requestId)) return prev
              const map = new Map(prev)
              map.delete(event.requestId)
              return map
            })
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
            // 桌面通知（带提示音 + 会话导航）
            sendBlockingNotification(
              sessionId,
              'Agent 计划待审批',
              'Agent 已完成计划，等待你的审批',
              'exitPlanMode'
            )
          } else if (event.type === 'enter_plan_mode') {
            // 进入 Plan 模式
            store.set(agentPlanModeSessionsAtom, (prev: Set<string>) =>
              updatePlanModeSessionSet(prev, sessionId, true)
            )
          } else if (event.type === 'plan_mode_changed') {
            // 计划阶段变化只影响输入框/横幅状态，不改用户选择的权限模式
            store.set(agentPlanModeSessionsAtom, (prev: Set<string>) =>
              updatePlanModeSessionSet(prev, sessionId, event.active)
            )
          } else if (event.type === 'permission_mode_changed') {
            // 权限模式变更（如 Plan 模式退出后切换到完全自动）
            console.log(`[GlobalAgentListeners] 权限模式变更: ${event.mode}`)
            store.set(agentPermissionModeMapAtom, (prev: Map<string, import('@proma/shared').PromaPermissionMode>) => {
              const next = new Map(prev)
              next.set(sessionId, event.mode)
              return next
            })
            store.set(agentPlanModeSessionsAtom, (prev: Set<string>) =>
              updatePlanModeSessionSet(prev, sessionId, event.mode === 'plan')
            )
          } else if (event.type === 'run_resumed') {
            // 后台任务完成自动唤醒：从"空闲可输入"恢复到"运行中"。
            store.set(agentStreamingStatesAtom, (prev) => {
              const current = prev.get(sessionId)
              if (!current || current.running) return prev
              const map = new Map(prev)
              map.set(sessionId, { ...current, running: true })
              return map
            })
          }
        }
        }) // unstable_batchedUpdates
    }
    // Pi adapter 已完成唯一一次 append-delta 合帧；renderer 按序直接归约，不能再丢 delta。
    const cleanupEvent = window.electronAPI.onAgentStreamEvent(handleStreamEvent)

    // ===== 2. 流式完成 =====
    const cleanupComplete = window.electronAPI.onAgentStreamComplete(
      (data: AgentStreamCompletePayload) => {
        const activeState = store.get(agentStreamingStatesAtom).get(data.sessionId)
        const currentRun = isAgentRunSignalForCurrent(
          activeState?.runId,
          data.runId,
          activeState?.startedAt,
          data.startedAt,
        )
        if (!currentRun) {
          console.warn(`[GlobalAgentListeners] 忽略非当前 run 完成事件: session=${data.sessionId.slice(0, 8)}, active=${activeState?.runId ?? activeState?.startedAt}, incoming=${data.runId ?? data.startedAt}`)
          return
        }
        clearStartedTools(data.sessionId)
        agentLiveTranscriptStore.clear(data.sessionId, data.runId)
        lastRunSequenceBySession.delete(data.sessionId)
        unstable_batchedUpdates(() => {
        // 后台任务等待态：turn 主体结束但仍有后台任务在飞行，UI 进入"空闲可输入"。
        // 不发"任务已完成"通知（任务并未真正完成）、不清后台任务列表、不重载消息——
        // 等后台任务完成时 Agent 会自动唤醒续轮。
        const backgroundTasksPending = data.backgroundTasksPending === true
        const hasStreamError = store.get(agentStreamErrorsAtom).has(data.sessionId)

        // 主进程随完成事件携带刚落盘的单条 meta；不要为此重新拉取整个会话索引。
        // 后台任务的轻量完成并未更新会话新鲜度，保留现有列表顺序。
        if (data.session && !backgroundTasksPending) {
          store.set(agentSessionsAtom, (prev) => upsertAgentSession(prev, data.session!))
        }

        // 发送桌面通知（仅真正成功完成时播放提示音，错误/中断/异常完成不伪装成完成）
        const completionSession = data.session ?? store.get(agentSessionsAtom)
          .find((session) => session.id === data.sessionId)
        const enabled = store.get(notificationsEnabledAtom)
        const soundEnabled = store.get(notificationSoundEnabledAtom)
        const sounds = store.get(notificationSoundsAtom)
        const sessionTitle = getSessionTitle(data.sessionId)
        notifyAgentCompletion({
          completion: data,
          session: completionSession,
          hasStreamError,
          notify: () => {
            sendDesktopNotification(
              'Agent 任务完成',
              `[${sessionTitle}] 任务已完成`,
              enabled,
              {
                playSound: enabled && soundEnabled,
                soundType: 'taskComplete',
                sounds,
                onNavigate: makeNavigateToSession(data.sessionId, sessionTitle),
              }
            )
          },
        })

        // STREAM_COMPLETE 表示后端已完全结束 — 立即标记 running: false
        // 同时将所有未完成的工具活动标记为已完成，防止 subagent spinner 继续转动
        // （complete 事件只清除 retrying，保持 running: true 以防竞态）
        // 竞态保护：通过 startedAt 区分新旧流，防止旧流的 complete 事件重置新流的 running 状态
        store.set(agentStreamingStatesAtom, (prev) => {
          const current = prev.get(data.sessionId)
          // 既非运行中、也非软空闲态 → 已彻底结束，忽略重复/陈旧的完成事件。
          // 软空闲态（running=false 但 backgroundWaiting=true）也要处理：空闲超时/用户停止
          // 触发的真正完成会带 backgroundTasksPending=false，需借此清除 backgroundWaiting。
          if (!current || (!current.running && !current.backgroundWaiting)) {
            return prev
          }
          if (current.startedAt != null && (data.startedAt == null || current.startedAt > data.startedAt)) {
            return prev
          }
          const map = new Map(prev)
          map.set(data.sessionId, {
            ...current,
            running: false,
            // backgroundTasksPending=true → 进入/保持软空闲态（通道仍开着，handleSend 走注入路径）；
            // false → 真正结束，清除软空闲态，新消息回到新建 run 路径。
            backgroundWaiting: backgroundTasksPending,
            ...finalizeStreamingActivities(current.toolActivities),
          })
          return map
        })

        // 只有未激活会话才进入"未查看完成"，避免当前页面完成时出现额外未读提醒。
        const currentSessionId = store.get(currentAgentSessionIdAtom)
        const completionMarkers = getAgentCompletionMarkers({
          tabs: store.get(tabsAtom),
          activeTabId: store.get(activeTabIdAtom),
          currentAgentSessionId: currentSessionId,
          sessionId: data.sessionId,
          session: completionSession,
          documentHasFocus: document.hasFocus(),
        })
        if (completionMarkers.markUnviewedCompleted && !backgroundTasksPending) {
          store.set(unviewedCompletedSessionIdsAtom, (prev: Set<string>) => {
            const next = new Set(prev)
            next.add(data.sessionId)
            return next
          })
        } else if (!backgroundTasksPending) {
          // 当前聚焦会话已在主应用可见；同步确认，避免灵动岛把这次完成继续当未读。
          void window.electronAPI.agentIsland.markSessionViewed(data.sessionId).catch(console.error)
        }

        // 对齐本次会话的主动打断状态，无需借助全量列表刷新重建整个 Set。
        store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
          const wasStopped = prev.has(data.sessionId)
          if (data.stoppedByUser === true && !wasStopped) {
            const next = new Set(prev)
            next.add(data.sessionId)
            return next
          }
          if (data.stoppedByUser !== true && wasStopped) {
            const next = new Set(prev)
            next.delete(data.sessionId)
            return next
          }
          return prev
        })

        if (!backgroundTasksPending) {
          scheduleQueuedMessageDispatch(data.sessionId)
        }

        // 非正常结束时显示截断提示
        if (data.resultSubtype && data.resultSubtype !== 'success' && !data.stoppedByUser) {
          const messages: Record<string, string> = {
            error_max_turns: '任务被中断：已达到轮次上限。继续对话可让 Agent 接着完成。',
            error_max_budget_usd: '任务被中断：已达到预算上限。',
            error_during_execution: '任务执行过程中发生错误。',
            empty_response: 'Agent 本轮结束了，但没有返回任何可展示内容。你的消息已保留，可以直接重试或切换模型。',
          }
          // error_during_execution 等执行期错误：优先展示 SDK result.errors[] 携带的真实原因，
          // 让用户能据此判断重试 / 改提问 / 报 bug，而非只看到泛泛的兜底文案。
          const detail = data.resultErrors?.find((e) => typeof e === 'string' && e.trim().length > 0)?.trim()
          const fallback = messages[data.resultSubtype] ?? `任务异常结束（${data.resultSubtype}）`
          const msg = detail
            ? `任务执行出错：${detail}`
            : fallback
          toast.warning(msg, { duration: 8000 })
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

          // 后台任务等待态：保留后台任务列表（面板继续显示在跑任务），不做收尾清理，
          // 等任务完成 Agent 自动唤醒续轮后再走真正的完成路径。
          if (backgroundTasksPending) return

          // 清理后台任务
          store.set(backgroundTasksAtomFamily(data.sessionId), [])

          // 清理该 session 关联的未完成写工具记录，防止内存泄漏
          for (const [toolId, entry] of pendingWriteTools) {
            if (entry.sessionId === data.sessionId) {
              pendingWriteTools.delete(toolId)
            }
          }
          for (const [toolId, sid] of pendingGitMutateTools) {
            if (sid === data.sessionId) {
              pendingGitMutateTools.delete(toolId)
            }
          }

          // 注意：liveMessages 的清理已移至 AgentView 消息加载完成后执行，
          // 与 streamingState 清理同步，避免「实时消息已清 → 持久化消息未到」的空档闪烁

          // 完成事件已携带当前会话 meta，顶部已增量更新列表；全量会话同步仅保留给启动、
          // 窗口重新聚焦和未知会话等恢复路径，避免完成一个 Agent 就传输整个会话索引。

          // 注意：流式状态的完全清除由 AgentView 在消息加载完成后执行，
          // 确保不会出现「气泡消失 → 持久化消息尚未加载」的空档闪烁
        }

        // 通知 AgentView 重新加载消息（无论是否为当前会话）
        if (!isNewStreamRunning()) {
          bumpRefresh()

          // 非当前会话不会等待 AgentView 的异步分页刷新；若保留其终态流
          // state，历史访问越多，后续任一 Agent 的 token 更新就越要复制更大的 Map。
          // JSONL 已在主进程落盘，重新打开时会按页加载，因此可立即释放。
          if (!backgroundTasksPending && currentSessionId !== data.sessionId) {
            store.set(agentStreamingStatesAtom, (prev) => {
              const state = prev.get(data.sessionId)
              if (!state || state.running || state.backgroundWaiting) return prev
              const next = new Map(prev)
              next.delete(data.sessionId)
              return next
            })
            store.set(liveMessagesMapAtom, (prev) => {
              if (!prev.has(data.sessionId)) return prev
              const next = new Map(prev)
              next.delete(data.sessionId)
              return next
            })
          }
        }
        finalize()
        }) // unstable_batchedUpdates
      }
    )

    // ===== 3. 流式错误 =====
    const cleanupError = window.electronAPI.onAgentStreamError(
      (data: AgentStreamErrorPayload) => {
        const activeState = store.get(agentStreamingStatesAtom).get(data.sessionId)
        if (!isAgentRunSignalForCurrent(activeState?.runId, data.runId, activeState?.startedAt, data.startedAt)) {
          console.warn(`[GlobalAgentListeners] 忽略非当前 run 错误: session=${data.sessionId.slice(0, 8)}, active=${activeState?.runId ?? activeState?.startedAt}, incoming=${data.runId}`)
          return
        }
        unstable_batchedUpdates(() => {
        clearStartedTools(data.sessionId)
        agentLiveTranscriptStore.clear(data.sessionId, data.runId)
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
        }) // unstable_batchedUpdates
      }
    )

    // ===== 4. 独立规划窗口 → 主窗口 Todo Agent 接力 =====
    const cleanupTodoAgentSessionReady = window.electronAPI.onTodoAgentSessionReady(({ todo, session }) => {
      unstable_batchedUpdates(() => {
        store.set(agentSessionsAtom, (prev) => upsertAgentSession(prev, session))
        const result = openTab(store.get(tabsAtom), { type: 'agent', sessionId: session.id, title: session.title })
        store.set(tabsAtom, result.tabs)
        store.set(activeTabIdAtom, result.activeTabId)
        store.set(appModeAtom, 'agent')
        store.set(currentAgentSessionIdAtom, session.id)
        if (session.workspaceId) {
          store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
          void window.electronAPI.updateSettings({ agentWorkspaceId: session.workspaceId }).catch(console.error)
        }
        store.set(agentPendingPromptAtom, {
          sessionId: session.id,
          message: buildTodoAgentPrompt(todo.id, true),
          mentionedTodoIds: [todo.id],
        })
      })
    })

    // ===== 5. 标题更新 =====
    const cleanupTitleUpdated = window.electronAPI.onAgentTitleUpdated(({ sessionId, title }) => {
      // 先使用事件 payload 立即同步标签页，避免依赖会话列表旧快照比较。
      store.set(tabsAtom, (tabs) => updateTabTitle(tabs, sessionId, title))
      const existing = store.get(agentSessionsAtom).find((session) => session.id === sessionId)
      if (existing) {
        // 标题写入会更新 updatedAt；本地以当前时刻维持与后端一致的“最近会话”排序，
        // 不再为一行标题变化传输整个会话索引。
        store.set(agentSessionsAtom, (prev) => upsertAgentSession(prev, {
          ...existing,
          title,
          updatedAt: Date.now(),
        }))
        return
      }
      // 外部桥接可能先发标题、后发 run-start；仅在本地未知该会话时刷新 active metadata。
      window.electronAPI
        .listAgentSessions('active')
        .then(mergeActiveSnapshot)
        .catch(console.error)
    })

    // ===== 6. Windows Agent Island 提示音委托 =====
    const cleanupPlaySound = window.electronAPI.onWindowsAgentIslandPlaySound(({ type }) => {
      const sounds = store.get(notificationSoundsAtom)
      void playNotificationSoundForType(type, sounds)
    })

    // 定期清理 60s 前的「最近修改」标记，避免 atom 无限增长
    const pruneTimer = setInterval(() => {
      const cutoff = Date.now() - RECENTLY_MODIFIED_TTL_MS
      store.set(recentlyModifiedPathsAtom, (prev) => {
        let changed = false
        const next = new Map<string, Map<string, number>>()
        for (const [sid, inner] of prev) {
          const filtered = new Map<string, number>()
          for (const [p, t] of inner) {
            if (t > cutoff) filtered.set(p, t)
            else changed = true
          }
          if (filtered.size > 0) next.set(sid, filtered)
          else changed = true
        }
        return changed ? next : prev
      })
    }, 15_000)

    // 窗口重新聚焦时检测当前预览文件是否有外部修改，有变化才刷新
    /** sessionId:filePath → 内容 hash（用于检测外部编辑器修改） */
    const fileContentHashMap = new Map<string, string>()
    const HASH_MAX = 100
    let focusCheckSeq = 0
    const bumpDiffRefresh = (sessionId: string) => {
      // 外部修改的精确路径无法从 focus 事件可靠取得，保守地失效全部缓存。
      void window.electronAPI.invalidateGitDiffCache().finally(() => {
        store.set(agentDiffRefreshVersionAtom, (prev) => {
          const m = new Map(prev)
          m.set(sessionId, (prev.get(sessionId) ?? 0) + 1)
          return m
        })
      })
    }

    const onWindowFocus = async () => {
      const activeSessionId = store.get(currentAgentSessionIdAtom)
      if (!activeSessionId) return

      const previewFile = store.get(previewFileMapAtom).get(activeSessionId)
      if (!previewFile || previewFile.previewOnly !== true) {
        bumpDiffRefresh(activeSessionId)
        return
      }

      const candidateBasePaths = uniqueTruthyPaths([
        ...(previewFile.basePaths ?? []),
        previewFile.dirPath,
        previewFile.gitRoot,
        getParentDir(previewFile.filePath),
        store.get(agentSessionPathMapAtom).get(activeSessionId),
      ])
      const hashKey = `${activeSessionId}:${previewFile.filePath}:${candidateBasePaths.join('\u001f')}`
      const seq = ++focusCheckSeq

      try {
        const result = await window.electronAPI.resolveAndReadFile(previewFile.filePath, {
          sessionId: activeSessionId,
          candidateBasePaths: candidateBasePaths.length > 0 ? candidateBasePaths : undefined,
        })

        // 丢弃过期结果（快速切换窗口时）
        if (seq !== focusCheckSeq) return

        const content = result?.content ?? ''
        // cyrb53 hash：遍历完整内容，避免边缘碰撞
        const hash = cyrb53(content)
        const prevHash = fileContentHashMap.get(hashKey)

        if (prevHash === undefined || prevHash !== hash) {
          // 首次建立 hash 基准时也刷新一次，避免用户离开窗口后首次外部修改被吞掉。
          bumpDiffRefresh(activeSessionId)
        }
        fileContentHashMap.set(hashKey, hash)

        // LRU 淘汰：限制 Map 大小
        if (fileContentHashMap.size > HASH_MAX) {
          const oldestKey = fileContentHashMap.keys().next().value
          if (oldestKey !== undefined) fileContentHashMap.delete(oldestKey)
        }
      } catch {
        // 读取失败时删除旧 hash，并触发一次刷新让预览进入真实失败/空状态。
        fileContentHashMap.delete(hashKey)
        bumpDiffRefresh(activeSessionId)
      }
    }
    window.addEventListener('focus', onWindowFocus)

    const syncVisibleAgentStreamSession = (): void => {
      const sessionId = store.get(activeSessionIdAtom)
      const activeTab = store.get(tabsAtom).find((tab) => tab.id === store.get(activeTabIdAtom))
      // Settings 以覆盖层呈现，主界面只是 hidden 而未卸载。此时不能继续把
      // Agent 当作前台会话以 20fps 推送，否则隐藏的历史树仍会抢占设置页主线程。
      const visibleAgentSessionId = !store.get(settingsOpenAtom)
        && (activeTab?.type === 'agent' || activeTab?.type === 'preview')
        ? sessionId
        : null
      // 开发时 renderer HMR 可能先于 preload/main 重启；缺少新 IPC 不应让整个应用白屏。
      const setVisibleAgentStreamSession = window.electronAPI.setVisibleAgentStreamSession
      if (setVisibleAgentStreamSession) {
        void setVisibleAgentStreamSession(visibleAgentSessionId).catch(console.error)
      }
    }
    syncVisibleAgentStreamSession()
    const unsubscribeVisibleSession = store.sub(activeSessionIdAtom, syncVisibleAgentStreamSession)
    const unsubscribeSettingsOpen = store.sub(settingsOpenAtom, syncVisibleAgentStreamSession)

    return () => {
      cleanupEvent()
      unsubscribeVisibleSession()
      unsubscribeSettingsOpen()
      cleanupComplete()
      cleanupError()
      cleanupTodoAgentSessionReady()
      cleanupTitleUpdated()
      cleanupPlaySound()
      cleanupWatchedFileChanges()
      queuedDispatchUnsubscribers.forEach((unsubscribe) => unsubscribe())
      clearInterval(pruneTimer)
      window.removeEventListener('focus', onWindowFocus)
    }
  }, [store]) // store 引用稳定，effect 只执行一次
}
