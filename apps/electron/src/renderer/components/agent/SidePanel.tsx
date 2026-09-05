/**
 * SidePanel — Agent 侧面板容器
 *
 * 直接展示文件浏览器，默认打开状态。
 * 切换按钮在面板关闭时显示活动指示点。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { X, ExternalLink, ChevronRight, MoreHorizontal, FolderSearch, Pencil, FolderInput, GitBranch, GitMerge, MessageSquarePlus, FileDiff, FileText, FolderOpen, Globe, MessageCircle, Brain, Split, Blocks, CalendarDays, ListTodo, Clock, ServerCog, SquareTerminal, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { getAttachedDirectoryStateKey } from '@/components/file-browser/file-browser-roots'
import { useFileTreeExpanded } from '@/components/file-browser/use-file-tree-expanded'
import { useAttachedDirectoryChildren } from '@/components/file-browser/use-attached-directory-children'
import { productivityToolsAtom } from '@/atoms/ui-preferences'
import { markdownToHtml } from '@/lib/markdown-rich-text'
import { FileBrowser, FileDropZone, FileTypeIcon, FileSearchBar, computeRevealAncestors, isPathUnderRoot, computeTreeRowLayout, AncestorGuides, STICKY_ROW_BASE_CLASS, canBeSticky } from '@/components/file-browser'
import { DiffPanelTabBar } from '@/components/diff/DiffPanelTabBar'
import type { RightWorkspaceTabDragState, WorkspacePanelTab } from '@/components/diff/DiffPanelTabBar'
import { DiffChangesList } from '@/components/diff/DiffChangesList'
import { ChatView } from '@/components/chat/ChatView'
import { AgentView } from '@/components/agent/AgentView'
import { VaultView } from '@/components/vault/VaultView'
import { OBSIDIAN_NAME, ObsidianIcon } from '@/components/obsidian/obsidian-brand'
import {
  currentSessionSidePanelOpenAtom,
  agentFileSourceFilterMapAtom,
  workspaceFilesVersionAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  agentSessionsAtom,
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  workspaceAttachedFilesMapAtom,
  agentPendingFilesAtomFamily,
  agentDiffRefreshVersionAtom,
  agentNonGitFileChangesAtom,
  agentFileChangesCurrentRunAtom,
  agentSessionComponentTabsAtomFamily,
  agentSessionStreamingStateAtomFamily,
  agentSessionIndicatorMapAtom,
  unviewedCompletedDelegatedSessionIdsAtom,
  isWorkspaceComponentTab,
  isUserPriorityWorkspaceComponentTab,
  sanitizeWorkspaceComponentTabs,
  getDelegationTabLabel,
  fileBrowserAutoRevealAtom,
  fileBrowserScrollTopMapAtom,
  isFileBrowserAutoRevealActive,
  pruneFileBrowserStateMap,
  agentSelectedWorktreeAtom,
  agentSideTemporaryAgentMapAtom,
  agentSideDelegationMapAtom,
  agentSDKMessagesCacheAtom,
  agentLiveMessagesAtomFamily,
  agentSessionDraftsAtom,
  agentSessionDraftSyncVersionsAtom,
  agentSessionDraftHtmlAtom,
  agentTerminalTabsAtom,
  agentSidePanelSplitMapAtom,
  agentSidePanelSplitRatioMapAtom,
} from '@/atoms/agent-atoms'
import {
  getBrowserSidePanelTab,
  getBrowserTabIdFromSidePanelTab,
  getDelegationSidePanelTab,
  getExplorationSessionIdFromSidePanelTab,
  getExplorationSidePanelTab,
  getPreviewIdFromSidePanelTab,
  getPreviewSidePanelTab,
  getTerminalIdFromSidePanelTab,
  getTerminalSidePanelTab,
} from '@/atoms/agent-atoms'
import type { AgentSidePanelTab, AgentFileSourceFilter, AgentExplorationBranchTab, WorkspaceComponentTab } from '@/atoms/agent-atoms'
import { WorkspaceMemoryTab } from '@/components/agent-skills/WorkspaceMemoryTab'
import { AgentSkillsView } from '@/components/agent-skills/AgentSkillsView'
import { PlanningView } from '@/components/planning/PlanningView'
import { AutomationFormView } from '@/components/automation/AutomationFormView'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { memoryFileNavigationAtom, workspaceMemoryChangesAtom } from '@/atoms/memory-change-atoms'
import { agentSideChatMapAtom } from '@/atoms/chat-atoms'
import {
  browserPanelMinimizedMapAtom,
  browserPanelOpenMapAtom,
  browserPendingNavigationMapAtom,
  browserStateMapAtom,
} from '@/atoms/browser-atoms'
import { BrowserPanel } from '@/components/browser/BrowserPanel'
import {
  getPreviewFileId,
  previewContentRefreshVersionAtom,
  previewResolvedPathAtom,
  previewFileMapAtom,
  previewFilesMapAtom,
  previewPanelOpenMapAtom,
} from '@/atoms/preview-atoms'
import { PreviewPanel } from '@/components/diff/PreviewPanel'
import { clearPreviewContentCacheForFile } from '@/lib/preview-content-cache'
import { useOpenPreview } from '@/components/diff/preview-opener'
import type { FileEntry, AgentPendingFile, AgentSessionMeta, SDKMessage, WorktreeInfo } from '@proma/shared'
import { setFilePanelDragData, getMediaTypeFromFilename, dispatchInsertFileMention } from '@/lib/file-panel-drag'
import { CLOSE_ACTIVE_RIGHT_WORKSPACE_TAB_EVENT } from '@/lib/right-workspace-events'
import {
  getPreviousRightPanelTab,
  recordRightPanelTabVisit,
  removeRightPanelTabFromHistory,
} from '@/lib/right-panel-tab-history'
import { getDelegatedChildSessionStatus, getDelegationStatusIconClass } from '@/lib/agent-session-list'
import { markSessionCompletionViewed } from '@/lib/agent-completion-presence'
import { rememberStopGenerationTarget } from '@/lib/stop-generation-target'
import { TerminalTabContent } from '@/components/tabs/TerminalTabContent'
import { shouldShowBothFileSources } from './file-panel-layout'
import {
  clampRightWorkspaceSplitRatio,
  clampRightWorkspaceSplitRatioForWidth,
  collapseRightWorkspaceSplit,
  createRightWorkspaceSplit,
  focusRightWorkspaceSplitPane,
  getFocusedRightWorkspaceTab,
  placeRightWorkspaceSplitTab,
  sanitizeRightWorkspaceSplit,
  selectRightWorkspaceSplitTab,
} from '@/lib/right-workspace-split'
import type { RightWorkspacePane, RightWorkspaceSplitState } from '@/lib/right-workspace-split'

function BrowserTabIcon({ favicon }: { favicon?: string }): React.ReactElement {
  const [loadFailed, setLoadFailed] = React.useState(false)
  React.useEffect(() => setLoadFailed(false), [favicon])

  if (!favicon || loadFailed) return <Globe className="size-3.5" />
  return <img src={favicon} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="size-3.5 shrink-0 rounded-sm object-contain" onError={() => setLoadFailed(true)} />
}

function MeasuredWorkspacePane({ children }: { children: (width: number) => React.ReactNode }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const publishWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width)
      setWidth((previous) => previous === nextWidth ? previous : nextWidth)
    }
    publishWidth()
    const observer = new ResizeObserver(publishWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {width !== null ? children(width) : null}
    </div>
  )
}

interface PersistentFileScrollAreaProps {
  stateKey: string
  className: string
  children: React.ReactNode
  autoRevealTs?: number
}

/** 保存 Files Tab 的滚动位置，并在文件树异步恢复内容后再次定位。 */
function PersistentFileScrollArea({ stateKey, className, children, autoRevealTs = 0 }: PersistentFileScrollAreaProps): React.ReactElement {
  const scrollTopMap = useAtomValue(fileBrowserScrollTopMapAtom)
  const setScrollTopMap = useSetAtom(fileBrowserScrollTopMapAtom)
  const scrollTop = scrollTopMap.get(stateKey) ?? 0
  const containerRef = React.useRef<HTMLDivElement>(null)
  // 用 stateKey 分隔最新值：切换文件来源时，旧 effect 的 cleanup 仍须写回旧视图的位置。
  const latestScrollTopByStateKeyRef = React.useRef(new Map<string, number>())
  const pendingFlushRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useLayoutEffect(() => {
    latestScrollTopByStateKeyRef.current.set(stateKey, scrollTop)
  }, [scrollTop, stateKey])

  React.useLayoutEffect(() => {
    // 新搜索的 scrollIntoView 优先于历史位置；过期 reveal 会在传入前被过滤。
    if (autoRevealTs) return

    const container = containerRef.current
    if (!container) return

    let firstFrame = 0
    let secondFrame = 0
    let mutationObserver: MutationObserver | null = null
    const restore = (): boolean => {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      const latestScrollTop = latestScrollTopByStateKeyRef.current.get(stateKey) ?? 0
      container.scrollTop = Math.min(latestScrollTop, maxScrollTop)
      return maxScrollTop >= latestScrollTop
    }
    const scheduleRestore = () => {
      if (restore()) {
        mutationObserver?.disconnect()
        return
      }
      firstFrame = requestAnimationFrame(() => {
        if (restore()) {
          mutationObserver?.disconnect()
          return
        }
        secondFrame = requestAnimationFrame(() => {
          if (restore()) mutationObserver?.disconnect()
        })
      })
    }

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleRestore)
      : null
    resizeObserver?.observe(container)
    // 仅在尚未达到保存位置时保留观察；深层目录慢速恢复后继续定位，达到目标即释放。
    mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(scheduleRestore)
      : null
    mutationObserver?.observe(container, { childList: true, subtree: true })
    scheduleRestore()

    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [autoRevealTs, stateKey])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const flush = () => {
      pendingFlushRef.current = null
      const nextScrollTop = latestScrollTopByStateKeyRef.current.get(stateKey) ?? 0
      setScrollTopMap((previous) => {
        if (previous.get(stateKey) === nextScrollTop) return previous
        const next = new Map(previous)
        next.set(stateKey, nextScrollTop)
        return next
      })
    }
    const handleScroll = () => {
      latestScrollTopByStateKeyRef.current.set(stateKey, container.scrollTop)
      if (pendingFlushRef.current === null) {
        pendingFlushRef.current = setTimeout(flush, 120)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (pendingFlushRef.current !== null) {
        clearTimeout(pendingFlushRef.current)
        pendingFlushRef.current = null
      }
      // Tab 切换卸载前同步落盘到内存 atom，避免最后 120ms 丢失。
      flush()
    }
  }, [setScrollTopMap, stateKey])

  return <div ref={containerRef} className={className}>{children}</div>
}

function getFileBrowserScrollStateKey(
  sessionId: string,
  view: string,
  roots: readonly { path: string; scope: string }[],
): string {
  const rootKey = roots
    .map((root) => `${root.scope}\u0000${root.path}`)
    .sort()
    .join('\u0001')
  return `${sessionId}\u0002files\u0002${view}\u0002${rootKey}`
}

function getPathBasename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
}

function getPathDirname(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : ''
}

function joinPath(parentDir: string, name: string): string {
  const separator = parentDir.includes('\\') && !parentDir.includes('/') ? '\\' : '/'
  return parentDir ? `${parentDir}${separator}${name}` : name
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char)
}

function getLatestExplorationConclusion(messages: SDKMessage[], sourceMessageId: string): string {
  // fork 会复制分叉点之前的完整历史；只能带回锚点之后的新 assistant 回复，
  // 否则刚打开分支就会把主线已有结论误当作探索结果。
  let sourceIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { uuid?: unknown }
    if (message.uuid === sourceMessageId) {
      sourceIndex = index
      break
    }
  }
  if (sourceIndex < 0) return ''

  for (let index = messages.length - 1; index > sourceIndex; index -= 1) {
    const message = messages[index] as { type?: unknown; message?: { content?: unknown } }
    if (message.type !== 'assistant' || !Array.isArray(message.message?.content)) continue
    const text = message.message.content
      .flatMap((block) => {
        if (!block || typeof block !== 'object') return []
        const record = block as { type?: unknown; text?: unknown }
        return record.type === 'text' && typeof record.text === 'string' ? [record.text] : []
      })
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

/**
 * 右侧嵌入 Agent 在切换时轻微淡入并横移 1px，缓和不同消息高度瞬间替换的视觉跳变。
 * 首次打开不播放，且尊重系统的减少动态效果偏好。
 */
function SideAgentSessionContent({
  contentKey,
  children,
  onView,
}: {
  contentKey: string
  children: React.ReactNode
  onView?: () => void
}): React.ReactElement {
  const previousContentKeyRef = React.useRef<string | null>(null)
  const onViewRef = React.useRef(onView)
  onViewRef.current = onView
  const shouldAnimate = previousContentKeyRef.current !== null && previousContentKeyRef.current !== contentKey

  React.useEffect(() => {
    previousContentKeyRef.current = contentKey
  }, [contentKey])

  // A delegated child may finish while hidden, then become visible simply because its parent
  // session is reopened. Rendering the visible content itself is a view acknowledgement; do not
  // require a second pointer or focus event inside the child pane to clear its completion state.
  React.useEffect(() => {
    onViewRef.current?.()
  }, [contentKey])

  return (
    <div
      key={contentKey}
      className={cn(
        'min-h-0 flex-1 overflow-hidden',
        shouldAnimate && 'animate-in fade-in-0 slide-in-from-right-1 duration-150 motion-reduce:animate-none',
      )}
      onFocusCapture={onView}
      onPointerDownCapture={onView}
    >
      {children}
    </div>
  )
}

/**
 * 探索分支正在流式输出时，只有带回按钮需要知道“是否已有新增 assistant 内容”。
 * 将该订阅隔离在小组件中，避免每个 token 都重渲染整块文件/Tab 侧栏。
 */
function ExplorationBringBackAction({
  parentSessionId,
  branch,
  sessions,
}: {
  parentSessionId: string
  branch: AgentExplorationBranchTab
  sessions: AgentSessionMeta[]
}): React.ReactElement {
  const explorationMessagesCache = useAtomValue(agentSDKMessagesCacheAtom)
  const explorationLiveMessages = useAtomValue(agentLiveMessagesAtomFamily(branch.sessionId))
  const parentDrafts = useAtomValue(agentSessionDraftsAtom)
  const parentDraftHtml = useAtomValue(agentSessionDraftHtmlAtom)
  const setParentDrafts = useSetAtom(agentSessionDraftsAtom)
  const setParentDraftSyncVersions = useSetAtom(agentSessionDraftSyncVersionsAtom)
  const setParentDraftHtml = useSetAtom(agentSessionDraftHtmlAtom)
  const latestExplorationConclusion = React.useMemo(
    () => getLatestExplorationConclusion(
      [...(explorationMessagesCache.get(branch.sessionId) ?? []), ...explorationLiveMessages],
      branch.sourceMessageId,
    ),
    [branch.sessionId, branch.sourceMessageId, explorationLiveMessages, explorationMessagesCache],
  )
  const handleBringExplorationBack = React.useCallback(() => {
    if (!latestExplorationConclusion) {
      toast.info('探索分支还没有可带回的 Agent 结论')
      return
    }
    const branchTitle = sessions.find((item) => item.id === branch.sessionId)?.title || '探索分支'
    const referenceLabel = `探索后新增内容 · ${branchTitle}`
    const referenceMarkdown = `这是探索后的新增内容：&session:${branch.sessionId}::${encodeURIComponent(referenceLabel)}`
    const referenceHtml = `<p>这是探索后的新增内容：<span data-type="mention" data-id="${escapeHtml(branch.sessionId)}" data-label="${escapeHtml(referenceLabel)}" data-mention-suggestion-char="&">${escapeHtml(referenceLabel)}</span></p>`
    setParentDraftSyncVersions((previous) => {
      const next = new Map(previous)
      next.set(parentSessionId, (next.get(parentSessionId) ?? 0) + 1)
      return next
    })
    setParentDrafts((previous) => {
      const next = new Map(previous)
      const current = parentDrafts.get(parentSessionId)?.trim() ?? ''
      next.set(parentSessionId, current ? `${current}\n\n${referenceMarkdown}` : referenceMarkdown)
      return next
    })
    setParentDraftHtml((previous) => {
      const currentHtml = parentDraftHtml.get(parentSessionId) || markdownToHtml(parentDrafts.get(parentSessionId) ?? '')
      const nextHtml = currentHtml ? `${currentHtml}<p></p>${referenceHtml}` : referenceHtml
      const next = new Map(previous)
      next.set(parentSessionId, nextHtml)
      return next
    })
    toast.success('已添加探索引用', { description: '探索 Tab 保持打开；主会话发送后 Agent 会读取该标记。' })
  }, [branch.sessionId, latestExplorationConclusion, parentDraftHtml, parentDrafts, parentSessionId, sessions, setParentDraftHtml, setParentDrafts, setParentDraftSyncVersions])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 active:scale-[0.96]" onClick={handleBringExplorationBack} disabled={!latestExplorationConclusion} aria-label="添加探索引用">
          <GitMerge className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{latestExplorationConclusion ? '将探索后新增内容作为会话引用添加到主线草稿；探索 Tab 保持打开，不会自动发送' : '完成一轮新的探索回复后即可添加引用'}</TooltipContent>
    </Tooltip>
  )
}

interface SidePanelProps {
  sessionId: string
  sessionPath: string | null
  activeTab: AgentSidePanelTab
  onTabChange: (tab: AgentSidePanelTab) => void
  width?: number
}

export function SidePanel({ sessionId, sessionPath, activeTab, onTabChange, width = 460 }: SidePanelProps): React.ReactElement {
  // 按会话保存最近访问顺序。该历史仅存在于当前 renderer 进程，避免恢复失效的临时 Tab。
  const rightPanelTabHistoryRef = React.useRef(new Map<string, AgentSidePanelTab[]>())
  const workspaceTabsRef = React.useRef<WorkspacePanelTab[]>([])

  React.useEffect(() => {
    const history = rightPanelTabHistoryRef.current.get(sessionId) ?? []
    rightPanelTabHistoryRef.current.set(sessionId, recordRightPanelTabVisit(history, activeTab))
  }, [activeTab, sessionId])

  const getPreviousTabBeforeClose = React.useCallback((closingTab: AgentSidePanelTab): AgentSidePanelTab => {
    const history = rightPanelTabHistoryRef.current.get(sessionId) ?? []
    const availableTabs = new Set(workspaceTabsRef.current
      .map((tab) => tab.id)
      .filter((tab) => tab !== closingTab))
    const nextTab = getPreviousRightPanelTab(history, closingTab, availableTabs)
    rightPanelTabHistoryRef.current.set(sessionId, removeRightPanelTabFromHistory(history, closingTab))
    return nextTab
  }, [sessionId])

  const returnToPreviousTabAfterClose = React.useCallback((closingTab: AgentSidePanelTab): AgentSidePanelTab => {
    const nextTab = getPreviousTabBeforeClose(closingTab)
    if (activeTab === closingTab) onTabChange(nextTab)
    return nextTab
  }, [activeTab, getPreviousTabBeforeClose, onTabChange])

  // 侧面板状态按 sessionId 持久化，切换会话不会互相覆盖。
  const [isOpen, setIsOpen] = useAtom(currentSessionSidePanelOpenAtom)
  // Tab 系统
  const previewFileMap = useAtomValue(previewFileMapAtom)
  const setPreviewFileMap = useSetAtom(previewFileMapAtom)
  const previewFilesMap = useAtomValue(previewFilesMapAtom)
  const setPreviewFilesMap = useSetAtom(previewFilesMapAtom)
  const setPreviewContentRefreshVersion = useSetAtom(previewContentRefreshVersionAtom)
  const setPreviewResolvedPaths = useSetAtom(previewResolvedPathAtom)
  const previewOpenMap = useAtomValue(previewPanelOpenMapAtom)
  const setPreviewOpenMap = useSetAtom(previewPanelOpenMapAtom)
  const previewFiles = previewFilesMap.get(sessionId) ?? []
  const requestedPreviewId = getPreviewIdFromSidePanelTab(activeTab)
  const currentPreviewFile = (requestedPreviewId ? previewFiles.find((file) => getPreviewFileId(file) === requestedPreviewId) : null)
    ?? previewFileMap.get(sessionId) ?? null
  const previewOpen = previewFiles.length > 0 || previewOpenMap.get(sessionId) === true
  const selectedFilePath = currentPreviewFile?.filePath

  const openPreview = useOpenPreview()
  const setBrowserOpenMap = useSetAtom(browserPanelOpenMapAtom)
  const setBrowserMinimizedMap = useSetAtom(browserPanelMinimizedMapAtom)

  // 用 ref 存 basePaths 相关值，避免声明顺序问题
  const basePathsRef = React.useRef<string[]>([])

  const handleFilePreview = React.useCallback((filePath: string) => {
    const bp = basePathsRef.current
    openPreview(sessionId, {
      filePath,
      previewOnly: true,
      basePaths: bp.length > 0 ? bp : undefined,
    })
  }, [sessionId, openPreview])

  // Worktree 选择状态（仅用于 diff 文件点击时传递 baseRef，选取逻辑已下沉至 DiffChangesList）
  const selectedWorktreeMap = useAtomValue(agentSelectedWorktreeAtom)
  const selectedWorktreePath = selectedWorktreeMap.get(sessionId) ?? null

  const handleDiffFileClick = React.useCallback((filePath: string, _isUntracked: boolean, gitRoot?: string) => {
    openPreview(sessionId, {
      filePath,
      dirPath: sessionPath || undefined,
      gitRoot,
      baseRef: selectedWorktreePath ? 'origin/main' : undefined,
    })
  }, [openPreview, sessionId, sessionPath, selectedWorktreePath])

  // 动画标志：isOpen 变化时启用过渡动画，切换会话时即时显示
  const prevIsOpenRef = React.useRef(isOpen)
  const prevSessionIdRef = React.useRef(sessionId)
  const shouldAnimate = prevSessionIdRef.current === sessionId && prevIsOpenRef.current !== isOpen
  React.useEffect(() => {
    prevIsOpenRef.current = isOpen
    prevSessionIdRef.current = sessionId
  })

  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const autoReveal = useAtomValue(fileBrowserAutoRevealAtom)
  const activeAutoRevealTs = autoReveal?.sessionId === sessionId && isFileBrowserAutoRevealActive(autoReveal)
    ? autoReveal.ts
    : 0
  const setFilesVersion = useSetAtom(workspaceFilesVersionAtom)
  const diffRefreshVersionMap = useAtomValue(agentDiffRefreshVersionAtom)
  const diffRefreshVersion = diffRefreshVersionMap.get(sessionId) ?? 0
  const nonGitFileChangesMap = useAtomValue(agentNonGitFileChangesAtom)
  const nonGitFileChanges = nonGitFileChangesMap.get(sessionId) ?? []
  const fileChangesCurrentRunMap = useAtomValue(agentFileChangesCurrentRunAtom)
  const fileChangesCurrentRunId = fileChangesCurrentRunMap.get(sessionId)

  // 文件面板必须跟随当前会话归属的项目。仅在会话元数据尚未加载时回退全局选择，
  // 避免用户切换项目列表但仍查看旧会话时读写错误项目根目录。
  const selectedWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const currentWorkspaceId = sessions.find((session) => session.id === sessionId)?.workspaceId ?? selectedWorkspaceId
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? null
  const projectRootPath = currentWorkspace?.projectRootPath ?? null
  const isProjectRootUnavailable = Boolean(
    currentWorkspace?.projectRootPath
    && currentWorkspace.projectRootStatus
    && currentWorkspace.projectRootStatus !== 'available',
  )
  // 文件面板展示的是 Agent 实际操作的文件系统，不能再被会话附件范围二次截断。
  const fileAccess = React.useMemo(() => ({ sessionId, unrestricted: true }), [sessionId])

  // 附加目录列表（会话级）
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []
  const attachedFilesMap = useAtomValue(agentAttachedFilesMapAtom)
  const setAttachedFilesMap = useSetAtom(agentAttachedFilesMapAtom)
  const attachedFiles = attachedFilesMap.get(sessionId) ?? []

  // 附加目录列表（工作区级）
  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const setWsAttachedDirsMap = useSetAtom(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []
  const wsAttachedFilesMap = useAtomValue(workspaceAttachedFilesMapAtom)
  const setWsAttachedFilesMap = useSetAtom(workspaceAttachedFilesMapAtom)
  const wsAttachedFiles = currentWorkspaceId ? (wsAttachedFilesMap.get(currentWorkspaceId) ?? []) : []

  const extraPathsMemo = React.useMemo(
    () => [...attachedDirs, ...wsAttachedDirs],
    [attachedDirs, wsAttachedDirs]
  )

  const fileAccessPathsMemo = React.useMemo(
    () => [...extraPathsMemo, ...attachedFiles, ...wsAttachedFiles],
    [extraPathsMemo, attachedFiles, wsAttachedFiles]
  )

  // 加载工作区级附加目录
  React.useEffect(() => {
    if (!workspaceSlug || !currentWorkspaceId) return
    window.electronAPI.getWorkspaceDirectories(workspaceSlug)
      .then((dirs) => {
        setWsAttachedDirsMap((prev) => {
          const map = new Map(prev)
          map.set(currentWorkspaceId, dirs)
          return map
        })
      })
      .catch(console.error)
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  // 加载工作区级附加文件
  React.useEffect(() => {
    if (!workspaceSlug || !currentWorkspaceId) return
    window.electronAPI.getWorkspaceAttachedFiles(workspaceSlug)
      .then((files) => {
        setWsAttachedFilesMap((prev) => {
          const map = new Map(prev)
          map.set(currentWorkspaceId, files)
          return map
        })
      })
      .catch(console.error)
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedFilesMap])

  // === 会话级：移除既有附加项 ===

  const handleDetachDirectory = React.useCallback(async (dirPath: string) => {
    try {
      const updated = await window.electronAPI.detachDirectory({ sessionId, directoryPath: dirPath })
      setAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) { map.set(sessionId, updated) } else { map.delete(sessionId) }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除附加目录失败:', error)
    }
  }, [sessionId, setAttachedDirsMap])

  const handleDetachFile = React.useCallback(async (filePath: string) => {
    try {
      const updated = await window.electronAPI.detachFile({ sessionId, filePath })
      setAttachedFilesMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) { map.set(sessionId, updated) } else { map.delete(sessionId) }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除附加文件失败:', error)
    }
  }, [sessionId, setAttachedFilesMap])

  const attachSessionDir = React.useCallback(async (dirPath: string) => {
    const updated = await window.electronAPI.attachDirectory({ sessionId, directoryPath: dirPath })
    setAttachedDirsMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, updated)
      return map
    })
  }, [sessionId, setAttachedDirsMap])

  const handleAttachSessionFolder = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (result) await attachSessionDir(result.path)
    } catch (error) {
      console.error('[SidePanel] 附加会话文件夹失败:', error)
    }
  }, [attachSessionDir])

  const handleSessionFoldersDropped = React.useCallback(async (folderPaths: string[]) => {
    for (const dirPath of folderPaths) {
      try { await attachSessionDir(dirPath) } catch (error) {
        console.error('[SidePanel] 拖拽附加会话文件夹失败:', error)
      }
    }
  }, [attachSessionDir])

  const attachSessionFile = React.useCallback(async (filePath: string) => {
    const updated = await window.electronAPI.attachFile({ sessionId, filePath })
    setAttachedFilesMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, updated)
      return map
    })
  }, [sessionId, setAttachedFilesMap])

  const handleSessionFilesAttached = React.useCallback(async (filePaths: string[]) => {
    for (const filePath of filePaths) {
      try { await attachSessionFile(filePath) } catch (error) {
        console.error('[SidePanel] 附加会话文件失败:', error)
      }
    }
  }, [attachSessionFile])

  // === 工作区级：附加/移除目录 ===

  const attachWorkspaceDir = React.useCallback(async (dirPath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    const updated = await window.electronAPI.attachWorkspaceDirectory({ workspaceSlug, directoryPath: dirPath })
    setWsAttachedDirsMap((prev) => {
      const map = new Map(prev)
      map.set(currentWorkspaceId, updated)
      return map
    })
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  const handleAttachWorkspaceFolder = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (result) await attachWorkspaceDir(result.path)
    } catch (error) {
      console.error('[SidePanel] 附加项目文件夹失败:', error)
    }
  }, [attachWorkspaceDir])

  const handleWorkspaceFoldersDropped = React.useCallback(async (folderPaths: string[]) => {
    for (const dirPath of folderPaths) {
      try { await attachWorkspaceDir(dirPath) } catch (error) {
        console.error('[SidePanel] 拖拽附加项目文件夹失败:', error)
      }
    }
  }, [attachWorkspaceDir])

  const handleDetachWorkspaceDirectory = React.useCallback(async (dirPath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    try {
      const updated = await window.electronAPI.detachWorkspaceDirectory({ workspaceSlug, directoryPath: dirPath })
      setWsAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) { map.set(currentWorkspaceId, updated) } else { map.delete(currentWorkspaceId) }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除工作区附加目录失败:', error)
    }
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])


  const attachWorkspaceFile = React.useCallback(async (filePath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    const updated = await window.electronAPI.attachWorkspaceFile({ workspaceSlug, filePath })
    setWsAttachedFilesMap((prev) => {
      const map = new Map(prev)
      map.set(currentWorkspaceId, updated)
      return map
    })
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedFilesMap])

  const handleWorkspaceFilesAttached = React.useCallback(async (filePaths: string[]) => {
    for (const filePath of filePaths) {
      try { await attachWorkspaceFile(filePath) } catch (error) {
        console.error('[SidePanel] 附加项目文件失败:', error)
      }
    }
  }, [attachWorkspaceFile])

  const handleDetachWorkspaceFile = React.useCallback(async (filePath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    try {
      const updated = await window.electronAPI.detachWorkspaceFile({ workspaceSlug, filePath })
      setWsAttachedFilesMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) { map.set(currentWorkspaceId, updated) } else { map.delete(currentWorkspaceId) }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除工作区附加文件失败:', error)
    }
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedFilesMap])

  // 文件上传完成后递增版本号，触发 FileBrowser 刷新
  const handleFilesUploaded = React.useCallback(() => {
    setFilesVersion((prev) => prev + 1)
  }, [setFilesVersion])

  // 添加文件到聊天
  const pendingFiles = useAtomValue(agentPendingFilesAtomFamily(sessionId))
  const setPendingFiles = useSetAtom(agentPendingFilesAtomFamily(sessionId))
  const handleAddToChat = React.useCallback((entry: FileEntry) => {
    // 先在 setter 外部检查去重，避免在 updater 函数内执行不可逆副作用
    if (pendingFiles.some((f) => f.sourcePath === entry.path)) return

    const pending: AgentPendingFile = {
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      filename: entry.name,
      mediaType: getMediaTypeFromFilename(entry.name),
      size: entry.size ?? 0,
      sourcePath: entry.path,
    }

    // 有 sourcePath 的文件发送时直接引用原路径，不需要存 base64
    setPendingFiles((prev) => [...prev, pending])
  }, [pendingFiles, setPendingFiles])


  // 工作区文件目录路径
  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  React.useEffect(() => {
    let disposed = false

    // 在相同 slug 重新关联本地目录时，先清除旧路径，避免旧目录短暂继续可见或被使用。
    setWorkspaceFilesPath(null)
    if (!workspaceSlug) return

    window.electronAPI.getWorkspaceFilesPath(workspaceSlug)
      .then((path) => {
        if (!disposed) setWorkspaceFilesPath(path)
      })
      .catch(() => {
        if (!disposed) setWorkspaceFilesPath(null)
      })

    return () => {
      disposed = true
    }
  }, [workspaceSlug, projectRootPath])

  const worktreeRepoPathsMemo = React.useMemo(
    () => [sessionPath, workspaceFilesPath, ...extraPathsMemo].filter(Boolean) as string[],
    [sessionPath, workspaceFilesPath, extraPathsMemo]
  )

  const fileSourceFilterMap = useAtomValue(agentFileSourceFilterMapAtom)
  const setFileSourceFilterMap = useSetAtom(agentFileSourceFilterMapAtom)
  const fileSourceFilter = fileSourceFilterMap[sessionId] ?? 'project'
  const setFileSourceFilter = React.useCallback((source: AgentFileSourceFilter) => {
    setFileSourceFilterMap((prev) => {
      if (prev[sessionId] === source) return prev
      return { ...prev, [sessionId]: source }
    })
  }, [sessionId, setFileSourceFilterMap])
  const sessionFileRoots = React.useMemo(
    () => sessionPath ? [{ path: sessionPath, scope: 'session' as const }] : [],
    [sessionPath],
  )
  const projectFileRoots = React.useMemo(
    () => workspaceFilesPath && !isProjectRootUnavailable
      ? [{ path: workspaceFilesPath, scope: 'project' as const }]
      : [],
    [isProjectRootUnavailable, workspaceFilesPath],
  )
  // Files 将会话与项目文件放在同一视图；FileBrowser 自己处理对应根目录的自动定位。
  // RightSidePanel 完全由用户控制，不因 Agent 文件变更自动打开。

  // 同步 basePaths ref（供 handleFilePreview 使用，避免 hooks 声明顺序问题）
  basePathsRef.current = [sessionPath, workspaceFilesPath, ...fileAccessPathsMemo].filter(Boolean) as string[]
  const hasSessionAttachedItems = attachedDirs.length > 0 || attachedFiles.length > 0
  const hasWorkspaceAttachedItems = wsAttachedDirs.length > 0 || wsAttachedFiles.length > 0
  const sideChatMap = useAtomValue(agentSideChatMapAtom)
  const setSideChatMap = useSetAtom(agentSideChatMapAtom)
  const sideChatConversationId = sideChatMap.get(sessionId) ?? null
  const sideTemporaryAgentMap = useAtomValue(agentSideTemporaryAgentMapAtom)
  const setSideTemporaryAgentMap = useSetAtom(agentSideTemporaryAgentMapAtom)
  const sideTemporaryAgents = sideTemporaryAgentMap.get(sessionId) ?? []
  const sideDelegationMap = useAtomValue(agentSideDelegationMapAtom)
  const setSideDelegationMap = useSetAtom(agentSideDelegationMapAtom)
  const setUnviewedDelegatedCompleted = useSetAtom(unviewedCompletedDelegatedSessionIdsAtom)
  const sideDelegationSessionId = sideDelegationMap.get(sessionId) ?? null
  const agentIndicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const terminalTabsMap = useAtomValue(agentTerminalTabsAtom)
  const setTerminalTabsMap = useSetAtom(agentTerminalTabsAtom)
  const terminalTabs = terminalTabsMap.get(sessionId) ?? []
  const activeTerminalId = getTerminalIdFromSidePanelTab(activeTab)
  const selectedDelegationSession = sideDelegationSessionId
    ? sessions.find((item) => item.id === sideDelegationSessionId && item.parentSessionId === sessionId && !!item.sourceDelegationId) ?? null
    : null
  const selectedDelegationStatus = selectedDelegationSession
    ? getDelegatedChildSessionStatus(selectedDelegationSession, agentIndicatorMap)
    : null
  const activeExplorationSessionId = getExplorationSessionIdFromSidePanelTab(activeTab)
  const activeExplorationBranch = activeExplorationSessionId
    ? sideTemporaryAgents.find((branch) => branch.sessionId === activeExplorationSessionId) ?? null
    : null
  // Todo / 日程 / 能力 / 记忆的数据仍归属于 workspace，但右侧 Tab 仅属于当前 session。
  const [workspaceComponentTabs, setWorkspaceComponentTabs] = useAtom(agentSessionComponentTabsAtomFamily(sessionId))
  const productivityTools = useAtomValue(productivityToolsAtom)
  const automationFormOpen = useAtomValue(automationFormAtom).open
  const isWorkspaceComponentEnabled = React.useCallback((component: WorkspaceComponentTab): boolean => (
    component !== 'todos' || productivityTools.todosEnabled
  ) && (
    component !== 'calendar' || productivityTools.calendarEnabled
  ) && (
    component !== 'vault' || productivityTools.obsidianEnabled
  ), [productivityTools.calendarEnabled, productivityTools.obsidianEnabled, productivityTools.todosEnabled])

  React.useEffect(() => {
    const validTabs = sanitizeWorkspaceComponentTabs(workspaceComponentTabs)
      .filter(isWorkspaceComponentEnabled)
    if (validTabs.length === workspaceComponentTabs.length && validTabs.every((tab, index) => tab === workspaceComponentTabs[index])) return
    setWorkspaceComponentTabs(validTabs)
  }, [isWorkspaceComponentEnabled, setWorkspaceComponentTabs, workspaceComponentTabs])

  const agentStreamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const memoryChangesMap = useAtomValue(workspaceMemoryChangesAtom)
  const setMemoryNavigationRequest = useSetAtom(memoryFileNavigationAtom)
  const latestMemoryChange = workspaceSlug ? memoryChangesMap.get(workspaceSlug)?.[0] : undefined
  const lastActivatedMemoryChangeRef = React.useRef<string | null>(null)
  const effectiveActiveTab: AgentSidePanelTab = activeTab === 'chat' && !sideChatConversationId
    ? 'files'
    // `temporary-agent` 是旧的单分支内存状态；新状态使用 exploration:<sessionId>。
    : activeTab === 'temporary-agent' || (activeExplorationSessionId !== null && !activeExplorationBranch) || (activeTab === 'delegation' && !selectedDelegationSession) || (activeTerminalId !== null && !terminalTabs.some((terminal) => terminal.terminalId === activeTerminalId))
      ? 'files'
      : isWorkspaceComponentTab(activeTab) && (!workspaceSlug || !workspaceComponentTabs.includes(activeTab) || !isWorkspaceComponentEnabled(activeTab))
        ? 'files'
        : activeTab
  const [splitMap, setSplitMap] = useAtom(agentSidePanelSplitMapAtom)
  const [splitRatioMap, setSplitRatioMap] = useAtom(agentSidePanelSplitRatioMapAtom)
  const split = splitMap.get(sessionId) ?? null
  const splitMapRef = React.useRef(splitMap)
  splitMapRef.current = splitMap
  const savedSplitRatio = clampRightWorkspaceSplitRatio(splitRatioMap[sessionId] ?? 0.5)

  const updateSplit = React.useCallback((next: RightWorkspaceSplitState | null) => {
    setSplitMap((previous) => {
      const current = previous.get(sessionId) ?? null
      if (current === next) return previous
      const updated = new Map(previous)
      if (next) updated.set(sessionId, next)
      else updated.delete(sessionId)
      return updated
    })
  }, [sessionId, setSplitMap])

  // memory 写入不能沿用通用组件激活：只有 watcher 捕获真实文件变更后才能生成受限 Diff。
  // SidePanel 按 session 挂载，因此只会为正在运行的来源 session 路由这次 Diff；其他会话不受影响。
  React.useEffect(() => {
    const runStartedAt = agentStreamState?.startedAt
    if (!agentStreamState?.running || !runStartedAt || !latestMemoryChange || latestMemoryChange.changedAt < runStartedAt) return
    const changeId = `${latestMemoryChange.relativePath}:${latestMemoryChange.changedAt}`
    if (lastActivatedMemoryChangeRef.current === changeId) return
    lastActivatedMemoryChangeRef.current = changeId
    setWorkspaceComponentTabs((previous) => previous.includes('memory') ? previous : [...previous, 'memory'])

    // 用户正在阅读 Skills 或项目记忆时，只保留新变更，不抢焦点或覆盖其当前文件。
    if (isOpen && isUserPriorityWorkspaceComponentTab(effectiveActiveTab)) return

    setMemoryNavigationRequest({ workspaceSlug: workspaceSlug!, relativePath: latestMemoryChange.relativePath, mode: 'change' })
    setIsOpen(true)
    onTabChange('memory')
  }, [agentStreamState?.running, agentStreamState?.startedAt, effectiveActiveTab, isOpen, latestMemoryChange, onTabChange, setIsOpen, setMemoryNavigationRequest, setWorkspaceComponentTabs, workspaceSlug])

  const handleClosePreviewTab = React.useCallback((previewId: string) => {
    const closingFile = previewFiles.find((file) => getPreviewFileId(file) === previewId)
    // 关闭代表结束这次预览生命周期；下次打开必须重新读盘，不能回落到旧 v0 缓存。
    if (closingFile?.previewOnly) clearPreviewContentCacheForFile(sessionId, closingFile.filePath)
    const remaining = previewFiles.filter((file) => getPreviewFileId(file) !== previewId)
    setPreviewFilesMap((previous) => {
      const next = new Map(previous)
      if (remaining.length > 0) next.set(sessionId, remaining)
      else next.delete(sessionId)
      return next
    })
    const fallback = remaining.at(-1) ?? null
    setPreviewContentRefreshVersion((previous) => {
      const key = `${sessionId}\u0000${previewId}`
      if (!previous.has(key)) return previous
      const next = new Map(previous)
      next.delete(key)
      return next
    })
    setPreviewFileMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, fallback)
      return next
    })
    setPreviewResolvedPaths((previous) => {
      const key = `${sessionId}\u0000${previewId}`
      if (!previous.has(key)) return previous
      const next = new Map(previous)
      next.delete(key)
      return next
    })
    setPreviewOpenMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, fallback !== null)
      return next
    })
    if (getPreviewIdFromSidePanelTab(activeTab) === previewId) returnToPreviousTabAfterClose(getPreviewSidePanelTab(previewId))
  }, [activeTab, previewFiles, returnToPreviousTabAfterClose, sessionId, setPreviewContentRefreshVersion, setPreviewFileMap, setPreviewFilesMap, setPreviewOpenMap, setPreviewResolvedPaths])

  const handleCloseChatTab = React.useCallback(() => {
    setSideChatMap((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
    if (activeTab === 'chat') returnToPreviousTabAfterClose('chat')
  }, [activeTab, returnToPreviousTabAfterClose, sessionId, setSideChatMap])

  const handleCloseExplorationTab = React.useCallback((branchSessionId: string) => {
    setSideTemporaryAgentMap((prev) => {
      const openBranches = prev.get(sessionId) ?? []
      const remaining = openBranches.filter((branch) => branch.sessionId !== branchSessionId)
      if (remaining.length === openBranches.length) return prev
      const next = new Map(prev)
      if (remaining.length > 0) next.set(sessionId, remaining)
      else next.delete(sessionId)
      return next
    })
    if (getExplorationSessionIdFromSidePanelTab(activeTab) === branchSessionId) {
      returnToPreviousTabAfterClose(getExplorationSidePanelTab(branchSessionId))
    }
  }, [activeTab, returnToPreviousTabAfterClose, sessionId, setSideTemporaryAgentMap])

  const handleCloseDelegationTab = React.useCallback(() => {
    setSideDelegationMap((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
    if (activeTab === 'delegation') {
      returnToPreviousTabAfterClose(getDelegationSidePanelTab())
    }
  }, [activeTab, returnToPreviousTabAfterClose, sessionId, setSideDelegationMap])

  // 分支是正常持久化会话，但若用户从左侧删除了它，右侧不能保留悬空 Tab。
  React.useEffect(() => {
    const validBranchIds = new Set(sessions.map((item) => item.id))
    const remaining = sideTemporaryAgents.filter((branch) => validBranchIds.has(branch.sessionId))
    if (remaining.length === sideTemporaryAgents.length) return
    setSideTemporaryAgentMap((prev) => {
      const current = prev.get(sessionId) ?? []
      const nextRemaining = current.filter((branch) => validBranchIds.has(branch.sessionId))
      if (nextRemaining.length === current.length) return prev
      const next = new Map(prev)
      if (nextRemaining.length > 0) next.set(sessionId, nextRemaining)
      else next.delete(sessionId)
      return next
    })
    if (activeExplorationSessionId && !validBranchIds.has(activeExplorationSessionId)) {
      returnToPreviousTabAfterClose(getExplorationSidePanelTab(activeExplorationSessionId))
    }
  }, [activeExplorationSessionId, returnToPreviousTabAfterClose, sessionId, sessions, setSideTemporaryAgentMap, sideTemporaryAgents])

  // 子 Agent 被从左侧删除后，同样移除右侧的悬空观察 Tab；不改变左侧树的现有渲染与排序。
  React.useEffect(() => {
    if (!sideDelegationSessionId) return
    const validChildIds = new Set(sessions
      .filter((item) => item.parentSessionId === sessionId && !!item.sourceDelegationId)
      .map((item) => item.id))
    if (validChildIds.has(sideDelegationSessionId)) return
    setSideDelegationMap((prev) => {
      if (prev.get(sessionId) !== sideDelegationSessionId) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
    if (activeTab === 'delegation') {
      returnToPreviousTabAfterClose(getDelegationSidePanelTab())
    }
  }, [activeTab, returnToPreviousTabAfterClose, sessionId, sessions, setSideDelegationMap, sideDelegationSessionId])

  // 浏览器状态由 MainArea 的全局订阅同步到 atom；右侧工作区只负责呈现和显式打开。
  // 这样切换文件/改动时 BrowserSlot 会正确隐藏原生 WebContentsView，而不会销毁网页会话。
  const browserStateMap = useAtomValue(browserStateMapAtom)
  const setBrowserStateMap = useSetAtom(browserStateMapAtom)
  const setPendingNavigationMap = useSetAtom(browserPendingNavigationMapAtom)
  const browserState = browserStateMap.get(sessionId) ?? null
  const openingBrowserSessionRef = React.useRef<string | null>(null)
  // 右侧 Tab 可被快速连续点击。队列必须同时按 Session/epoch 隔离；SidePanel
  // 组件会跨 Session 复用，旧 Session 的异步 IPC 绝不能消费新 Session 的 tabId。
  const browserSelectionQueueRef = React.useRef({ sessionId, epoch: 0, desiredTabId: null as string | null, running: false })
  if (browserSelectionQueueRef.current.sessionId !== sessionId) {
    browserSelectionQueueRef.current = {
      sessionId,
      epoch: browserSelectionQueueRef.current.epoch + 1,
      desiredTabId: null,
      running: false,
    }
  }

  const publishBrowserState = React.useCallback((state: NonNullable<typeof browserState>) => {
    setBrowserStateMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, state)
      return next
    })
    setBrowserMinimizedMap((previous) => {
      const next = new Map(previous)
      next.delete(sessionId)
      return next
    })
    setBrowserOpenMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, true)
      return next
    })
  }, [sessionId, setBrowserMinimizedMap, setBrowserOpenMap, setBrowserStateMap])

  const ensureBrowserOpen = React.useCallback(async () => {
    if (openingBrowserSessionRef.current === sessionId) return null
    const open = (window.electronAPI as Partial<typeof window.electronAPI>).openAgentBrowser
    if (typeof open !== 'function') return null
    openingBrowserSessionRef.current = sessionId
    try {
      const state = await open(sessionId)
      publishBrowserState(state)
      return state
    } catch (error) {
      console.error('[SidePanel] 打开受管浏览器失败:', error)
      return null
    } finally {
      if (openingBrowserSessionRef.current === sessionId) openingBrowserSessionRef.current = null
    }
  }, [publishBrowserState, sessionId])

  const flushBrowserTabSelection = React.useCallback(() => {
    const queue = browserSelectionQueueRef.current
    if (queue.sessionId !== sessionId || queue.running) return
    queue.running = true
    const runEpoch = queue.epoch
    void (async () => {
      try {
        while (true) {
          const current = browserSelectionQueueRef.current
          if (current.sessionId !== sessionId || current.epoch !== runEpoch) return
          const targetTabId = current.desiredTabId
          if (!targetTabId) return
          current.desiredTabId = null
          const state = await window.electronAPI.selectAgentBrowserTab({ sessionId, tabId: targetTabId })
          const latest = browserSelectionQueueRef.current
          if (latest.sessionId !== sessionId || latest.epoch !== runEpoch) return
          publishBrowserState(state)
        }
      } catch (error) {
        console.error('[SidePanel] 切换受管浏览器标签失败:', error)
      } finally {
        const current = browserSelectionQueueRef.current
        if (current.sessionId !== sessionId || current.epoch !== runEpoch) return
        current.running = false
        // 请求完成的瞬间可能又点击了其他标签，继续落到最终目标。
        if (current.desiredTabId) flushBrowserTabSelection()
      }
    })()
  }, [publishBrowserState, sessionId])

  const markDelegationSessionViewed = React.useCallback((childSessionId: string) => {
    setUnviewedDelegatedCompleted((prev) => markSessionCompletionViewed(prev, childSessionId))
  }, [setUnviewedDelegatedCompleted])

  const handleCloseSidePanel = React.useCallback(() => {
    // Closing the whole right workspace hides every auxiliary conversation.
    rememberStopGenerationTarget({ kind: 'agent', sessionId })
    setIsOpen(false)
  }, [sessionId, setIsOpen])

  const handleWorkspaceTabChange = React.useCallback((tab: AgentSidePanelTab) => {
    if (tab === 'delegation' && sideDelegationSessionId) {
      rememberStopGenerationTarget({ kind: 'agent', sessionId: sideDelegationSessionId })
      markDelegationSessionViewed(sideDelegationSessionId)
    } else {
      const explorationSessionId = getExplorationSessionIdFromSidePanelTab(tab)
      if (explorationSessionId && sideTemporaryAgents.some((branch) => branch.sessionId === explorationSessionId)) {
        rememberStopGenerationTarget({ kind: 'agent', sessionId: explorationSessionId })
      } else if (tab === 'chat' && sideChatConversationId) {
        rememberStopGenerationTarget({ kind: 'chat', sessionId: sideChatConversationId })
      }
    }

    // 记忆编辑器采用防抖自动保存，并在组件卸载时 flush；切换组件不丢草稿。
    const previewId = getPreviewIdFromSidePanelTab(tab)
    if (previewId) {
      const file = previewFiles.find((item) => getPreviewFileId(item) === previewId)
      if (file) {
        setPreviewFileMap((previous) => {
          const next = new Map(previous)
          next.set(sessionId, file)
          return next
        })
      }
    }
    const browserTabId = getBrowserTabIdFromSidePanelTab(tab)
    if (split) updateSplit(selectRightWorkspaceSplitTab(split, tab))
    onTabChange(tab)
    if (!browserTabId) return
    const queue = browserSelectionQueueRef.current
    if (queue.sessionId !== sessionId) return
    queue.desiredTabId = browserTabId
    flushBrowserTabSelection()
  }, [flushBrowserTabSelection, markDelegationSessionViewed, onTabChange, previewFiles, sessionId, setPreviewFileMap, sideChatConversationId, sideDelegationSessionId, sideTemporaryAgents, split, updateSplit])

  // Agent/浏览器等外部事件仍只更新兼容 activeTab；分屏时把新目标落到当前焦点 Pane。
  React.useEffect(() => {
    if (!split || getFocusedRightWorkspaceTab(split) === effectiveActiveTab) return
    updateSplit(selectRightWorkspaceSplitTab(split, effectiveActiveTab))
  }, [effectiveActiveTab, split, updateSplit])

  const handleOpenBrowserTab = React.useCallback(async () => {
    try {
      const state = browserState
        ? await window.electronAPI.createAgentBrowserTab({ sessionId })
        : await ensureBrowserOpen()
      if (!state) return
      publishBrowserState(state)
      handleWorkspaceTabChange(getBrowserSidePanelTab(state.activeTabId))
    } catch (error) {
      console.error('[SidePanel] 新建受管浏览器标签失败:', error)
    }
  }, [browserState, ensureBrowserOpen, handleWorkspaceTabChange, publishBrowserState, sessionId])

  const handleOpenTerminal = React.useCallback((cwd?: string, title = '终端') => {
    const terminalId = crypto.randomUUID()
    setTerminalTabsMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, [...(next.get(sessionId) ?? []), { terminalId, title, cwd }])
      return next
    })
    handleWorkspaceTabChange(getTerminalSidePanelTab(terminalId))
  }, [handleWorkspaceTabChange, sessionId, setTerminalTabsMap])

  const handleOpenWorktreeTerminal = React.useCallback((worktree: WorktreeInfo) => {
    handleOpenTerminal(worktree.path, `终端 · ${worktree.branch}`)
  }, [handleOpenTerminal])

  const handleOpenDirectoryTerminal = React.useCallback((directoryPath: string, directoryName: string) => {
    handleOpenTerminal(directoryPath, `终端 · ${directoryName}`)
  }, [handleOpenTerminal])

  const handleCloseBrowserTab = React.useCallback(async (browserTabId: string): Promise<boolean> => {
    try {
      const state = await window.electronAPI.closeAgentBrowserTab({ sessionId, tabId: browserTabId })
      if (state) {
        publishBrowserState(state)
        if (getBrowserTabIdFromSidePanelTab(activeTab) === browserTabId) {
          handleWorkspaceTabChange(getPreviousTabBeforeClose(getBrowserSidePanelTab(browserTabId)))
        } else {
          getPreviousTabBeforeClose(getBrowserSidePanelTab(browserTabId))
        }
        return true
      }
      setBrowserOpenMap((previous) => {
        const next = new Map(previous)
        next.set(sessionId, false)
        return next
      })
      setBrowserMinimizedMap((previous) => {
        const next = new Map(previous)
        next.delete(sessionId)
        return next
      })
      setBrowserStateMap((previous) => {
        const next = new Map(previous)
        next.delete(sessionId)
        return next
      })
      setPendingNavigationMap((previous) => {
        const next = new Map(previous)
        next.delete(sessionId)
        return next
      })
      returnToPreviousTabAfterClose(getBrowserSidePanelTab(browserTabId))
      return true
    } catch (error) {
      console.error('[SidePanel] 关闭受管浏览器标签失败:', error)
      return false
    }
  }, [activeTab, getPreviousTabBeforeClose, handleWorkspaceTabChange, publishBrowserState, returnToPreviousTabAfterClose, sessionId, setBrowserMinimizedMap, setBrowserOpenMap, setBrowserStateMap, setPendingNavigationMap])

  const activeBrowserTabId = getBrowserTabIdFromSidePanelTab(effectiveActiveTab)
  React.useEffect(() => {
    if (activeBrowserTabId && !browserState?.tabs.some((tab) => tab.tabId === activeBrowserTabId)) {
      returnToPreviousTabAfterClose(getBrowserSidePanelTab(activeBrowserTabId))
    }
  }, [activeBrowserTabId, browserState?.tabs, returnToPreviousTabAfterClose])

  const showBrowserActivity = Boolean(browserState?.activity && browserState.executionSource !== 'user')
  // WebContentsView 是原生子视图，会盖住 renderer 的 portal。加号菜单打开时，
  // BrowserPanel 为它保留一个固定避让区，而非 setVisible(false)。
  React.useEffect(() => {
    if (activeTab !== 'todos' && activeTab !== 'calendar' && activeTab !== 'vault') return
    if (!isWorkspaceComponentEnabled(activeTab)) onTabChange('files')
  }, [activeTab, isWorkspaceComponentEnabled, onTabChange])

  const [isAddTabMenuOpen, setIsAddTabMenuOpen] = React.useState(false)
  const workspaceTabs = React.useMemo<WorkspacePanelTab[]>(() => [
    { id: 'files', label: '文件', icon: <FolderOpen className="size-3.5" /> },
    { id: 'changes', label: '改动', icon: <FileDiff className="size-3.5" /> },
    ...workspaceComponentTabs.map((component) => {
      const meta: Record<WorkspaceComponentTab, { label: string; icon: React.ReactNode }> = {
        todos: { label: 'Todo', icon: <ListTodo className="size-3.5" /> },
        calendar: { label: '日程', icon: <CalendarDays className="size-3.5" /> },
        automations: { label: '定时任务', icon: <Clock className="size-3.5" /> },
        skills: { label: 'Skills', icon: <Blocks className="size-3.5" /> },
        mcp: { label: 'MCP', icon: <ServerCog className="size-3.5" /> },
        memory: { label: '项目记忆', icon: <Brain className="size-3.5" /> },
        vault: { label: OBSIDIAN_NAME, icon: <ObsidianIcon className="size-3.5" /> },
      }
      return { id: component, ...meta[component], closable: true }
    }),
    ...previewFiles.map((file) => ({
      id: getPreviewSidePanelTab(getPreviewFileId(file)),
      label: file.filePath.split(/[\\/]/).pop() || '预览',
      icon: <FileText className="size-3.5" />,
      closable: true,
    })),
    ...terminalTabs.map((terminal) => ({
      id: getTerminalSidePanelTab(terminal.terminalId),
      label: terminal.title,
      icon: <SquareTerminal className="size-3.5" />,
      closable: true,
    })),
    ...(sideChatConversationId ? [{ id: 'chat' as const, label: '问答', icon: <MessageCircle className="size-3.5" />, closable: true }] : []),
    ...sideTemporaryAgents.map((branch) => ({
      id: getExplorationSidePanelTab(branch.sessionId),
      label: sessions.find((item) => item.id === branch.sessionId)?.title || '探索分支',
      icon: <Split className="size-3.5" />,
      closable: true,
    })),
    ...(selectedDelegationSession && selectedDelegationStatus ? [{
      id: getDelegationSidePanelTab(),
      label: getDelegationTabLabel(selectedDelegationSession.title),
      icon: <GitBranch className={cn('size-3.5', getDelegationStatusIconClass(selectedDelegationStatus))} />,
      status: selectedDelegationStatus,
      closable: true,
    }] : []),
    ...(browserState?.tabs.map((tab) => ({
      id: getBrowserSidePanelTab(tab.tabId),
      label: tab.title || '新建标签页',
      icon: <BrowserTabIcon favicon={tab.favicon} />,
      // 用户可关闭任何浏览器标签；关闭 Agent 工作标签后，后续未指定 tabId 的工具会提示新建或选择工作标签。
      closable: true,
      activity: showBrowserActivity && activeBrowserTabId !== tab.tabId && browserState.activeTabId === tab.tabId,
    })) ?? []),
  ], [activeBrowserTabId, browserState, previewFiles, selectedDelegationSession, selectedDelegationStatus, sessions, showBrowserActivity, sideChatConversationId, sideTemporaryAgents, terminalTabs, workspaceComponentTabs])
  workspaceTabsRef.current = workspaceTabs

  React.useEffect(() => {
    if (!split) return
    const availableTabs = new Set<AgentSidePanelTab>(workspaceTabs.map((tab) => tab.id))
    const resolution = sanitizeRightWorkspaceSplit(split, availableTabs)
    if (resolution.split === split && resolution.activeTab === effectiveActiveTab) return
    updateSplit(resolution.split)
    if (resolution.activeTab !== effectiveActiveTab) onTabChange(resolution.activeTab)
  }, [effectiveActiveTab, onTabChange, split, updateSplit, workspaceTabs])

  const exitSplitInsteadOfClosingBoundTab = React.useCallback((tab: AgentSidePanelTab): boolean => {
    const currentSplit = splitMapRef.current.get(sessionId) ?? null
    if (!currentSplit || (tab !== currentSplit.leftTab && tab !== currentSplit.rightTab)) return false
    // 关闭命令作用于绑定组时不销毁成员；等同“退出并排，保留当前焦点”。
    handleWorkspaceTabChange(collapseRightWorkspaceSplit(currentSplit))
    updateSplit(null)
    return true
  }, [handleWorkspaceTabChange, sessionId, updateSplit])

  const handleCloseWorkspaceTab = React.useCallback((tab: AgentSidePanelTab) => {
    if (exitSplitInsteadOfClosingBoundTab(tab)) return
    const terminalId = getTerminalIdFromSidePanelTab(tab)
    if (terminalId) {
      void window.electronAPI.killTerminal(terminalId).catch(console.error)
      setTerminalTabsMap((previous) => {
        const current = previous.get(sessionId) ?? []
        if (!current.some((terminal) => terminal.terminalId === terminalId)) return previous
        const next = new Map(previous)
        const remaining = current.filter((terminal) => terminal.terminalId !== terminalId)
        if (remaining.length > 0) next.set(sessionId, remaining)
        else next.delete(sessionId)
        return next
      })
      returnToPreviousTabAfterClose(tab)
      return
    }
    if (isWorkspaceComponentTab(tab)) {
      setWorkspaceComponentTabs((previous) => previous.filter((component) => component !== tab))
      returnToPreviousTabAfterClose(tab)
      return
    }
    const previewId = getPreviewIdFromSidePanelTab(tab)
    if (previewId) { handleClosePreviewTab(previewId); return }
    if (tab === 'chat') { handleCloseChatTab(); return }
    const explorationSessionId = getExplorationSessionIdFromSidePanelTab(tab)
    if (explorationSessionId) { handleCloseExplorationTab(explorationSessionId); return }
    if (tab === 'delegation') { handleCloseDelegationTab(); return }
    const browserTabId = getBrowserTabIdFromSidePanelTab(tab)
    if (browserTabId) void handleCloseBrowserTab(browserTabId)
  }, [exitSplitInsteadOfClosingBoundTab, handleCloseBrowserTab, handleCloseChatTab, handleCloseDelegationTab, handleCloseExplorationTab, handleClosePreviewTab, returnToPreviousTabAfterClose, sessionId, setTerminalTabsMap, setWorkspaceComponentTabs])

  React.useEffect(() => {
    const handleCloseActiveWorkspaceTab = (event: Event) => {
      const { sessionId: targetSessionId } = (event as CustomEvent<{ sessionId?: string }>).detail ?? {}
      if (targetSessionId === sessionId) handleCloseWorkspaceTab(activeTab)
    }
    window.addEventListener(CLOSE_ACTIVE_RIGHT_WORKSPACE_TAB_EVENT, handleCloseActiveWorkspaceTab)
    return () => window.removeEventListener(CLOSE_ACTIVE_RIGHT_WORKSPACE_TAB_EVENT, handleCloseActiveWorkspaceTab)
  }, [activeTab, handleCloseWorkspaceTab, sessionId])

  const splitContentRef = React.useRef<HTMLDivElement>(null)
  const splitDividerCancelRef = React.useRef<(() => void) | null>(null)
  const [tabDrag, setTabDrag] = React.useState<RightWorkspaceTabDragState | null>(null)
  const [dragTargetPane, setDragTargetPane] = React.useState<RightWorkspacePane | null>(null)

  React.useEffect(() => () => splitDividerCancelRef.current?.(), [sessionId])

  const resolveDragTargetPane = React.useCallback((state: RightWorkspaceTabDragState): RightWorkspacePane | null => {
    const rect = splitContentRef.current?.getBoundingClientRect()
    if (!rect || state.clientY < rect.top || state.clientY > rect.bottom || state.clientX < rect.left || state.clientX > rect.right) return null
    return state.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
  }, [])

  const handleTabDragChange = React.useCallback((state: RightWorkspaceTabDragState | null) => {
    setTabDrag(state)
    setDragTargetPane(state ? resolveDragTargetPane(state) : null)
  }, [resolveDragTargetPane])

  const handleSplitTab = React.useCallback((tab: AgentSidePanelTab, pane: RightWorkspacePane) => {
    const next = split
      ? placeRightWorkspaceSplitTab(split, tab, pane)
      : createRightWorkspaceSplit(effectiveActiveTab, tab, pane, savedSplitRatio)
    if (!next) return
    // 先复用既有 Tab 激活副作用，再以明确的左右布局覆盖 split map。
    handleWorkspaceTabChange(tab)
    updateSplit(next)
  }, [effectiveActiveTab, handleWorkspaceTabChange, savedSplitRatio, split, updateSplit])

  const handleTabDrop = React.useCallback((state: RightWorkspaceTabDragState) => {
    const pane = resolveDragTargetPane(state)
    if (pane) handleSplitTab(state.tabId, pane)
    setTabDrag(null)
    setDragTargetPane(null)
  }, [handleSplitTab, resolveDragTargetPane])

  const handleCollapseSplit = React.useCallback(() => {
    if (!split) return
    const retainedTab = collapseRightWorkspaceSplit(split)
    handleWorkspaceTabChange(retainedTab)
    updateSplit(null)
  }, [handleWorkspaceTabChange, split, updateSplit])

  const handleFocusPane = React.useCallback((pane: RightWorkspacePane) => {
    if (!split || split.focusedPane === pane) return
    const next = focusRightWorkspaceSplitPane(split, pane)
    handleWorkspaceTabChange(getFocusedRightWorkspaceTab(next))
    updateSplit(next)
  }, [handleWorkspaceTabChange, split, updateSplit])

  const persistSplitRatio = React.useCallback((ratio: number) => {
    setSplitRatioMap((previous) => ({ ...previous, [sessionId]: clampRightWorkspaceSplitRatio(ratio) }))
  }, [sessionId, setSplitRatioMap])

  const handleSplitDividerMouseDown = React.useCallback((event: React.MouseEvent) => {
    if (!split) return
    event.preventDefault()
    splitDividerCancelRef.current?.()
    const container = splitContentRef.current
    if (!container) return
    const startX = event.clientX
    const width = container.clientWidth || 1
    const startRatio = clampRightWorkspaceSplitRatioForWidth(split.ratio, width)
    let latestX = startX
    let latestRatio = startRatio
    let frame = 0
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const apply = () => {
      latestRatio = clampRightWorkspaceSplitRatioForWidth(startRatio + (latestX - startX) / width, width)
      setSplitMap((previous) => {
        const current = previous.get(sessionId)
        if (!current || current.ratio === latestRatio) return previous
        const next = new Map(previous)
        next.set(sessionId, { ...current, ratio: latestRatio })
        return next
      })
    }
    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', cancel)
      if (splitDividerCancelRef.current === cancel) splitDividerCancelRef.current = null
    }
    const cancel = () => cleanup()
    const onMove = (moveEvent: MouseEvent) => {
      latestX = moveEvent.clientX
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; apply() })
    }
    const onUp = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      apply()
      persistSplitRatio(latestRatio)
      cleanup()
    }
    splitDividerCancelRef.current = cancel
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    window.addEventListener('blur', cancel)
  }, [persistSplitRatio, sessionId, setSplitMap, split])

  const resetSplitRatio = React.useCallback(() => {
    if (!split) return
    updateSplit({ ...split, ratio: 0.5 })
    persistSplitRatio(0.5)
  }, [persistSplitRatio, split, updateSplit])

  const renderFileSourceContent = (scope: 'session' | 'project'): React.ReactElement => {
    const isSession = scope === 'session'
    const hasAttachedItems = isSession ? hasSessionAttachedItems : hasWorkspaceAttachedItems
    const roots = isSession ? sessionFileRoots : projectFileRoots

    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={isSession ? '会话文件' : '项目文件'}>
        <h3 className="flex h-8 shrink-0 items-center px-3 text-[11px] font-medium text-muted-foreground">
          {isSession ? '会话文件' : '项目文件'}
        </h3>
        <PersistentFileScrollArea
          stateKey={getFileBrowserScrollStateKey(sessionId, scope, roots)}
          autoRevealTs={activeAutoRevealTs}
          className="min-h-0 flex-1 overflow-y-auto scrollbar-thin pt-1"
        >
          {isSession && attachedFiles.length > 0 && (
            <AttachedFilesSection scope="session" showSessionBadge={false} attachedFiles={attachedFiles} onDetach={handleDetachFile} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} allowedPaths={basePathsRef.current} sessionId={sessionId} />
          )}
          {isSession && attachedDirs.length > 0 && (
            <AttachedDirsSection scope="session" showSessionBadge={false} attachedDirs={attachedDirs} onDetach={handleDetachDirectory} refreshVersion={filesVersion} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} onOpenDirectoryTerminal={handleOpenDirectoryTerminal} allowedPaths={basePathsRef.current} sessionId={sessionId} />
          )}
          {!isSession && wsAttachedFiles.length > 0 && (
            <AttachedFilesSection scope="project" attachedFiles={wsAttachedFiles} onDetach={handleDetachWorkspaceFile} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} allowedPaths={basePathsRef.current} sessionId={sessionId} />
          )}
          {!isSession && wsAttachedDirs.length > 0 && (
            <AttachedDirsSection scope="project" attachedDirs={wsAttachedDirs} onDetach={handleDetachWorkspaceDirectory} refreshVersion={filesVersion} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} onOpenDirectoryTerminal={handleOpenDirectoryTerminal} allowedPaths={basePathsRef.current} sessionId={sessionId} />
          )}
          {!isSession && isProjectRootUnavailable && <div className="mx-2 my-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">本地项目根目录不可用；当前会话文件仍可访问。</div>}
          <FileBrowser roots={roots} access={fileAccess} projectRootPath={isProjectRootUnavailable ? null : workspaceFilesPath} showSessionBadge={false} hideToolbar embedded hideEmpty={hasAttachedItems} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} onOpenDirectoryTerminal={handleOpenDirectoryTerminal} />
          {workspaceSlug && (isSession ? (
            <FileDropZone workspaceSlug={workspaceSlug} sessionId={sessionId} target="session" onFilesUploaded={handleFilesUploaded} onFilesAttached={handleSessionFilesAttached} onAttachFolder={handleAttachSessionFolder} onFoldersDropped={handleSessionFoldersDropped} />
          ) : !isProjectRootUnavailable ? (
            <FileDropZone workspaceSlug={workspaceSlug} target="workspace" onFilesUploaded={handleFilesUploaded} onFilesAttached={handleWorkspaceFilesAttached} onAttachFolder={handleAttachWorkspaceFolder} onFoldersDropped={handleWorkspaceFoldersDropped} />
          ) : null)}
        </PersistentFileScrollArea>
      </section>
    )
  }

  const renderWorkspaceTabContent = (paneTab: AgentSidePanelTab, paneWidth: number): React.ReactNode => {
    const panePreviewId = getPreviewIdFromSidePanelTab(paneTab)
    const panePreviewFile = (panePreviewId ? previewFiles.find((file) => getPreviewFileId(file) === panePreviewId) : null)
      ?? previewFileMap.get(sessionId) ?? null
    const paneBrowserTabId = getBrowserTabIdFromSidePanelTab(paneTab)
    const paneExplorationSessionId = getExplorationSessionIdFromSidePanelTab(paneTab)
    const paneExplorationBranch = paneExplorationSessionId
      ? sideTemporaryAgents.find((branch) => branch.sessionId === paneExplorationSessionId) ?? null
      : null
    const paneDelegationSessionId = paneTab === 'delegation' ? sideDelegationSessionId : null
    const paneDelegationSession = paneDelegationSessionId
      ? sessions.find((item) => item.id === paneDelegationSessionId && item.parentSessionId === sessionId && !!item.sourceDelegationId) ?? null
      : null
    const paneTerminalId = getTerminalIdFromSidePanelTab(paneTab)
    const paneTerminal = paneTerminalId ? terminalTabs.find((terminal) => terminal.terminalId === paneTerminalId) ?? null : null
    // Files 的双来源布局必须由它所在 Pane 的真实宽度决定，而不是整个右侧工作区宽度。
    const showBothFileSources = shouldShowBothFileSources(paneWidth)
    const showSessionFiles = showBothFileSources || fileSourceFilter === 'session'
    const showProjectFiles = showBothFileSources || fileSourceFilter === 'project'
    const visibleFileRoots = [
      ...(showProjectFiles ? projectFileRoots : []),
      ...(showSessionFiles ? sessionFileRoots : []),
    ]
    const hasVisibleSessionAttachedItems = showSessionFiles && hasSessionAttachedItems
    const hasVisibleWorkspaceAttachedItems = showProjectFiles && hasWorkspaceAttachedItems

    if (paneTerminal) {
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <TerminalTabContent terminalId={paneTerminal.terminalId} sessionId={sessionId} cwd={paneTerminal.cwd ?? sessionPath ?? undefined} terminateOnUnmount={false} />
        </div>
      )
    }

    return (
    panePreviewId && panePreviewFile ? (
      <div className="min-h-0 flex-1 overflow-hidden"><PreviewPanel sessionId={sessionId} file={panePreviewFile} onClose={() => handleClosePreviewTab(panePreviewId)} /></div>
    ) : paneBrowserTabId ? (
      browserState && browserState.tabs.some((tab) => tab.tabId === paneBrowserTabId) ? (
        tabDrag ? (
          <div className="flex flex-1 items-center justify-center bg-muted/15 text-xs text-muted-foreground">释放后恢复浏览器视图</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <BrowserPanel
              sessionId={sessionId}
              tabId={paneBrowserTabId}
              state={browserState}
              isAddTabMenuOpen={isAddTabMenuOpen}
            />
          </div>
        )
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">浏览器标签已关闭</div>
      )
    ) : paneTab === 'chat' ? (
      sideChatConversationId ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatView conversationId={sideChatConversationId} />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">暂无问答会话</div>
      )
    ) : paneExplorationBranch ? (
      <SideAgentSessionContent contentKey={`exploration:${paneExplorationBranch.sessionId}`}>
        <AgentView sessionId={paneExplorationBranch.sessionId} embedded />
      </SideAgentSessionContent>
    ) : paneDelegationSession ? (
      <SideAgentSessionContent
        contentKey={`delegation:${paneDelegationSession.id}`}
        onView={() => markDelegationSessionViewed(paneDelegationSession.id)}
      >
        <AgentView sessionId={paneDelegationSession.id} embedded />
      </SideAgentSessionContent>
    ) : paneTab === 'todos' ? (
      <PlanningView embedded componentTab="todos" />
    ) : paneTab === 'calendar' ? (
      <PlanningView embedded componentTab="calendar" />
    ) : paneTab === 'automations' ? (
      automationFormOpen ? <AutomationFormView embedded /> : <PlanningView embedded componentTab="automations" />
    ) : paneTab === 'skills' ? (
      <AgentSkillsView embedded componentTab="skills" workspaceId={currentWorkspaceId ?? undefined} sessionId={sessionId} />
    ) : paneTab === 'mcp' ? (
      <AgentSkillsView embedded componentTab="mcp" workspaceId={currentWorkspaceId ?? undefined} sessionId={sessionId} />
    ) : paneTab === 'memory' ? (
      workspaceSlug ? (
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          <WorkspaceMemoryTab workspaceSlug={workspaceSlug} sessionId={sessionId} embedded onCloseChangeView={() => handleCloseWorkspaceTab('memory')} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">等待项目初始化...</div>
      )
    ) : paneTab === 'vault' ? (
      <div className="min-h-0 flex-1 overflow-hidden"><VaultView embedded sessionId={sessionId} /></div>
    ) : paneTab === 'changes' ? (
      sessionPath ? (
        <DiffChangesList
          key={sessionId}
          dirPath={workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.projectRootPath ?? sessionPath}
          sessionId={sessionId}
          sessionPath={sessionPath}
          workspaceFilesPath={workspaceFilesPath || undefined}
          extraPaths={fileAccessPathsMemo}
          refreshVersion={diffRefreshVersion}
          selectedFilePath={selectedFilePath}
          onFileClick={handleDiffFileClick}
          workspaceSlug={workspaceSlug || undefined}
          worktreeRepoPaths={worktreeRepoPathsMemo}
          onOpenWorktreeTerminal={handleOpenWorktreeTerminal}
          nonGitFileChanges={nonGitFileChanges}
          currentFileChangeRunId={fileChangesCurrentRunId}
          onPlainFileClick={handleFilePreview}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">等待会话初始化...</div>
      )
    ) : paneTab === 'files' ? (
      <div className="flex-1 min-h-0 flex flex-col pt-2 mx-2 mb-2">
        {sessionPath ? (
          <>
            <FileSearchBar
              workspaceFilesPath={isProjectRootUnavailable ? null : workspaceFilesPath}
              sessionPath={sessionPath}
              sessionAttachedDirs={attachedDirs}
              workspaceAttachedDirs={wsAttachedDirs}
              sourceFilter={showBothFileSources ? 'all' : fileSourceFilter}
              showSessionBadge={showBothFileSources}
              placeholder="搜索文件..."
              sessionId={sessionId}
              onFilePreview={handleFilePreview}
            >
              {!showBothFileSources && (
                <div className="file-source-tabbar main-tabbar mt-1.5 flex h-7 border-b border-border/80" role="tablist" aria-label="文件来源">
                  <button
                    type="button"
                    role="tab"
                    className={cn(
                      'relative flex-1 h-7 px-2 text-[11px] transition-colors select-none',
                      fileSourceFilter === 'project'
                        ? 'app-tab-active text-foreground'
                        : 'app-tab-inactive text-muted-foreground hover:text-foreground',
                    )}
                    aria-selected={fileSourceFilter === 'project'}
                    onClick={() => setFileSourceFilter('project')}
                  >
                    项目文件
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={cn(
                      'relative flex-1 h-7 px-2 text-[11px] transition-colors select-none',
                      fileSourceFilter === 'session'
                        ? 'app-tab-active text-foreground'
                        : 'app-tab-inactive text-muted-foreground hover:text-foreground',
                    )}
                    aria-selected={fileSourceFilter === 'session'}
                    onClick={() => setFileSourceFilter('session')}
                  >
                    会话文件
                  </button>
                </div>
              )}
            </FileSearchBar>
            {showBothFileSources ? (
              <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border/70 overflow-hidden pt-2">
                {renderFileSourceContent('project')}
                {renderFileSourceContent('session')}
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pt-1">
                {/* 拖拽引用提示：引用块样式，左侧竖线 + 缩进，与下方文件列表内容左对齐 */}
                <div className="mb-1.5 ml-4 border-l-2 border-primary/40 pl-2 text-[11px] leading-4 text-foreground/75">
                  支持拖拽文件或文件夹到输入框，实现引用
                </div>
                {showProjectFiles && wsAttachedFiles.length > 0 && (
                  <AttachedFilesSection scope="project" attachedFiles={wsAttachedFiles} onDetach={handleDetachWorkspaceFile} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} allowedPaths={basePathsRef.current} sessionId={sessionId} />
                )}
                {showProjectFiles && wsAttachedDirs.length > 0 && (
                  <AttachedDirsSection scope="project" attachedDirs={wsAttachedDirs} onDetach={handleDetachWorkspaceDirectory} refreshVersion={filesVersion} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} onOpenDirectoryTerminal={handleOpenDirectoryTerminal} allowedPaths={basePathsRef.current} sessionId={sessionId} />
                )}
                {showSessionFiles && attachedFiles.length > 0 && (
                  <AttachedFilesSection scope="session" showSessionBadge={false} attachedFiles={attachedFiles} onDetach={handleDetachFile} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} allowedPaths={basePathsRef.current} sessionId={sessionId} />
                )}
                {showSessionFiles && attachedDirs.length > 0 && (
                  <AttachedDirsSection scope="session" showSessionBadge={false} attachedDirs={attachedDirs} onDetach={handleDetachDirectory} refreshVersion={filesVersion} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} onOpenDirectoryTerminal={handleOpenDirectoryTerminal} allowedPaths={basePathsRef.current} sessionId={sessionId} />
                )}
                {showProjectFiles && isProjectRootUnavailable && (
                  <div className="mx-2 my-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    本地项目根目录不可用；当前会话文件仍可访问。
                  </div>
                )}
                <FileBrowser roots={visibleFileRoots} access={fileAccess} projectRootPath={isProjectRootUnavailable ? null : workspaceFilesPath} showSessionBadge={false} hideToolbar embedded hideEmpty={hasVisibleSessionAttachedItems || hasVisibleWorkspaceAttachedItems} onAddToChat={handleAddToChat} onFilePreview={handleFilePreview} onOpenDirectoryTerminal={handleOpenDirectoryTerminal} />
                {showSessionFiles && workspaceSlug && (
                  <FileDropZone workspaceSlug={workspaceSlug} sessionId={sessionId} target="session" onFilesUploaded={handleFilesUploaded} onFilesAttached={handleSessionFilesAttached} onAttachFolder={handleAttachSessionFolder} onFoldersDropped={handleSessionFoldersDropped} />
                )}
                {showProjectFiles && !isProjectRootUnavailable && workspaceSlug && (
                  <FileDropZone workspaceSlug={workspaceSlug} target="workspace" onFilesUploaded={handleFilesUploaded} onFilesAttached={handleWorkspaceFilesAttached} onAttachFolder={handleAttachWorkspaceFolder} onFoldersDropped={handleWorkspaceFoldersDropped} />
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">等待会话初始化...</div>
        )}
      </div>
    ) : null
    )
  }

  const effectiveSplitRatio = split ? clampRightWorkspaceSplitRatioForWidth(split.ratio, width) : 0.5

  const renderWorkspacePane = (pane: RightWorkspacePane, tab: AgentSidePanelTab): React.ReactElement => {
    return (
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-content-area"
        aria-label={`${pane === 'left' ? '左侧' : '右侧'} Pane：${tab}`}
        onPointerDownCapture={() => handleFocusPane(pane)}
      >
        <MeasuredWorkspacePane>{(paneWidth) => renderWorkspaceTabContent(tab, paneWidth)}</MeasuredWorkspacePane>
      </section>
    )
  }

  return (
    <div
      className={cn(
        'relative z-0 h-full flex-shrink-0 overflow-hidden titlebar-drag-region bg-content-area',
        shouldAnimate && 'transition-[width] duration-300 ease-in-out',
        isOpen ? '' : '!w-0',
      )}
      style={isOpen ? { width } : undefined}
    >
      {/* 面板内容 */}
      <div
        className={cn(
          'w-full h-full flex flex-col titlebar-no-drag',
          shouldAnimate && 'transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        >
          <DiffPanelTabBar
            key={sessionId}
            tabs={workspaceTabs}
            activeTab={effectiveActiveTab}
            onTabChange={handleWorkspaceTabChange}
            onCloseTab={handleCloseWorkspaceTab}
            onOpenBrowser={() => void handleOpenBrowserTab()}
            onAddTabMenuOpenChange={setIsAddTabMenuOpen}
            onOpenFile={() => handleWorkspaceTabChange('files')}
            onOpenTerminal={handleOpenTerminal}
            onOpenWorkspaceComponent={(component) => {
              if (!isWorkspaceComponentEnabled(component)) return
              setWorkspaceComponentTabs((previous) => previous.includes(component) ? previous : [...previous, component])
              handleWorkspaceTabChange(component)
            }}
            onOpenVault={productivityTools.obsidianEnabled ? () => {
              setWorkspaceComponentTabs((previous) => previous.includes('vault') ? previous : [...previous, 'vault'])
              setIsOpen(true)
              handleWorkspaceTabChange('vault')
            } : undefined}
            productivityTools={productivityTools}
            visibleTabs={split ? { left: split.leftTab, right: split.rightTab } : undefined}
            focusedPane={split?.focusedPane}
            onTabDragChange={handleTabDragChange}
            onTabDrop={handleTabDrop}
            onSplitTab={handleSplitTab}
            onCollapseSplit={split ? handleCollapseSplit : undefined}
            activeTabAction={activeExplorationBranch ? (
              <ExplorationBringBackAction parentSessionId={sessionId} branch={activeExplorationBranch} sessions={sessions} />
            ) : undefined}
            onClose={handleCloseSidePanel}
          />

          <div ref={splitContentRef} className="relative flex min-h-0 flex-1 overflow-hidden">
            {split ? (
              <>
                <div className="flex min-h-0 min-w-0" style={{ flex: `0 0 calc(${effectiveSplitRatio * 100}% - 4px)` }}>
                  {renderWorkspacePane('left', split.leftTab)}
                </div>
                <div
                  className="group relative w-2 shrink-0 cursor-col-resize bg-border/35 transition-colors hover:bg-primary/25 active:bg-primary/45"
                  onMouseDown={handleSplitDividerMouseDown}
                  onDoubleClick={resetSplitRatio}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整并排宽度；双击恢复均分"
                >
                  <span className="pointer-events-none absolute left-1/2 top-1/2 h-9 w-px -translate-x-1/2 -translate-y-1/2 bg-foreground/15 group-hover:bg-primary/50" />
                </div>
                <div className="flex min-h-0 min-w-0 flex-1">{renderWorkspacePane('right', split.rightTab)}</div>
              </>
            ) : (
              <MeasuredWorkspacePane>{(paneWidth) => renderWorkspaceTabContent(effectiveActiveTab, paneWidth)}</MeasuredWorkspacePane>
            )}

            {tabDrag && (
              <div className="absolute inset-0 z-[90] grid grid-cols-2 gap-2 bg-background/90 p-3">
                {(['left', 'right'] as const).map((pane) => (
                  <div
                    key={pane}
                    className={cn(
                      'flex items-center justify-center rounded-xl text-xs font-medium transition-[background-color,color,box-shadow,transform]',
                      dragTargetPane === pane
                        ? 'scale-[1.01] bg-primary/12 text-foreground shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.55)]'
                        : 'bg-card/65 text-muted-foreground shadow-sm',
                    )}
                  >
                    在{pane === 'left' ? '左侧' : '右侧'}并排
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    </div>
  )
}

// ===== 附加文件容器 =====

interface AttachedFilesSectionProps {
  title?: string
  scope?: 'project' | 'session'
  showSessionBadge?: boolean
  attachedFiles: string[]
  onDetach: (filePath: string) => void
  onAddToChat?: (entry: FileEntry) => void
  onFilePreview?: (filePath: string) => void
  allowedPaths?: string[]
  sessionId: string
}

function AttachedFilesSection({ title, scope = 'project', showSessionBadge = true, attachedFiles, onDetach, onAddToChat, onFilePreview, allowedPaths, sessionId }: AttachedFilesSectionProps): React.ReactElement {
  return (
    <div className="pt-1 pb-0 flex-shrink-0">
      {title && <div className="text-[11px] font-medium text-muted-foreground mb-1 px-3">{title}</div>}
      {attachedFiles.map((filePath) => {
        const name = getPathBasename(filePath)
        const entry: FileEntry = { name, path: filePath, isDirectory: false }
        return (
          <div
            key={filePath}
            className="flex items-center gap-1 py-1 pl-2 pr-2 text-sm cursor-pointer hover:bg-accent/50 group mx-2 rounded-lg"
            onClick={() => onFilePreview?.(filePath)}
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              setFilePanelDragData(e.dataTransfer, [{
                path: filePath,
                name,
                isDirectory: false,
                scope,
              }])
            }}
          >
            <span className="w-3.5 flex-shrink-0" />
            <FileTypeIcon name={name} isDirectory={false} />
            <span className="text-xs truncate flex-1" title={filePath}>{name}</span>
            {showSessionBadge && scope === 'session' && (
              <span className="flex-shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">会话文件</span>
            )}
            <div
              className="flex-shrink-0 mr-1"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent/70 text-muted-foreground hover:text-foreground invisible group-hover:visible focus-visible:visible data-[state=open]:visible"
                    title="更多操作"
                    aria-label="更多操作"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => dispatchInsertFileMention([{
                      path: filePath,
                      name,
                      isDirectory: false,
                      scope,
                    }])}
                  >
                    <MessageSquarePlus />
                    引用到 Agent
                  </DropdownMenuItem>
                  {onAddToChat && (
                    <DropdownMenuItem
                      className="text-xs py-1 [&>svg]:size-3.5"
                      onSelect={() => onAddToChat(entry)}
                    >
                      <MessageSquarePlus />
                      添加到聊天
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => window.electronAPI.showAttachedInFolder(filePath, { sessionId, candidateBasePaths: allowedPaths }).catch(console.error)}
                  >
                    <FolderSearch />
                    在文件夹中显示
                  </DropdownMenuItem>
                  {onFilePreview && (
                    <DropdownMenuItem
                      className="text-xs py-1 [&>svg]:size-3.5"
                      onSelect={() => onFilePreview(filePath)}
                    >
                      <ExternalLink />
                      打开文件
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-xs py-1 text-destructive focus:text-destructive [&>svg]:size-3.5"
                    onSelect={() => onDetach(filePath)}
                  >
                    <X />
                    移除附加
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ===== 附加目录容器（管理选中状态） =====

interface AttachedDirsSectionProps {
  title?: string
  scope?: 'project' | 'session'
  showSessionBadge?: boolean
  attachedDirs: string[]
  onDetach: (dirPath: string) => void
  /** 文件版本号，用于自动刷新已展开的目录 */
  refreshVersion: number
  onAddToChat?: (entry: FileEntry) => void
  onFilePreview?: (filePath: string) => void
  /** 在右侧工作区中以指定目录为 cwd 打开终端。 */
  onOpenDirectoryTerminal?: (directoryPath: string, directoryName: string) => void
  /** 所有允许访问的路径（传给 IPC 做路径校验） */
  allowedPaths?: string[]
  sessionId: string
}

/** 附加目录区域：统一管理所有子项的选中状态 */
function AttachedDirsSection({ title, scope = 'project', showSessionBadge = true, attachedDirs, onDetach, refreshVersion, onAddToChat, onFilePreview, onOpenDirectoryTerminal, allowedPaths, sessionId }: AttachedDirsSectionProps): React.ReactElement {
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set())

  // ===== 接入搜索点击触发的 reveal：附加目录文件搜到后，需要展开/选中目标 =====
  const autoReveal = useAtomValue(fileBrowserAutoRevealAtom)
  const activeAutoReveal = autoReveal?.sessionId === sessionId && isFileBrowserAutoRevealActive(autoReveal) ? autoReveal : null
  // 找到 reveal target 命中的那个附加目录根。如果用户附加了嵌套目录（如同时附加 /a 和 /a/b），
  // 取"最深匹配"——只让真正包含该文件的最近一棵树展开，避免外层 /a 树被无谓打开。
  const revealRoot = React.useMemo(() => {
    if (!activeAutoReveal) return null
    let best: string | null = null
    for (const dir of attachedDirs) {
      if (!isPathUnderRoot(dir, activeAutoReveal.path)) continue
      if (!best || dir.length > best.length) best = dir
    }
    return best
  }, [activeAutoReveal, attachedDirs])
  const revealTarget = revealRoot ? activeAutoReveal!.path : null
  const revealTs = revealRoot ? activeAutoReveal!.ts : 0
  const revealSelect = revealRoot ? !!activeAutoReveal!.select : false

  // 命中本区域 + select=true：把目标加入选中态（与 FileBrowser 行为对齐）
  const consumedSelectTsRef = React.useRef(0)
  React.useEffect(() => {
    if (!revealSelect || !revealTarget || revealTs === 0) return
    if (revealTs <= consumedSelectTsRef.current) return
    consumedSelectTsRef.current = revealTs
    setSelectedPaths(new Set([revealTarget]))
  }, [revealTs, revealSelect, revealTarget])

  const handleSelect = React.useCallback((path: string, ctrlKey: boolean) => {
    setSelectedPaths((prev) => {
      if (ctrlKey) {
        // Ctrl+点击：切换选中
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      }
      // 普通点击：单选
      return new Set([path])
    })
  }, [])

  return (
    <div className="file-tree-guide-scope pt-1 pb-0 flex-shrink-0">
      {title && <div className="text-[11px] font-medium text-muted-foreground mb-1 px-3">{title}</div>}
      {attachedDirs.map((dir) => {
        const isRevealRoot = dir === revealRoot
        return (
          <AttachedDirTree
            key={getAttachedDirectoryStateKey(sessionId, scope, dir)}
            dirPath={dir}
            onDetach={() => onDetach(dir)}
            selectedPaths={selectedPaths}
            onSelect={handleSelect}
            refreshVersion={refreshVersion}
            onAddToChat={onAddToChat}
            onFilePreview={onFilePreview}
            onOpenDirectoryTerminal={onOpenDirectoryTerminal}
            allowedPaths={allowedPaths}
            sessionId={sessionId}
            scope={scope}
            showSessionBadge={showSessionBadge}
            revealTarget={isRevealRoot ? revealTarget : null}
            revealTs={isRevealRoot ? revealTs : 0}
          />
        )
      })}
    </div>
  )
}

// ===== 附加目录树组件 =====

interface AttachedDirTreeProps {
  dirPath: string
  onDetach: () => void
  selectedPaths: Set<string>
  onSelect: (path: string, ctrlKey: boolean) => void
  refreshVersion: number
  onAddToChat?: (entry: FileEntry) => void
  onFilePreview?: (filePath: string) => void
  onOpenDirectoryTerminal?: (directoryPath: string, directoryName: string) => void
  allowedPaths?: string[]
  sessionId: string
  scope: 'project' | 'session'
  showSessionBadge: boolean
  /** 自动定位目标（仅当落在此 dirPath 之下时由父级传入，否则为 null） */
  revealTarget?: string | null
  /** 自动定位脉冲时间戳，变化时重新触发 */
  revealTs?: number
}

function AttachedDirTree({ dirPath, onDetach, selectedPaths, onSelect, refreshVersion, onAddToChat, onFilePreview, onOpenDirectoryTerminal, allowedPaths, sessionId, scope, showSessionBadge, revealTarget = null, revealTs = 0 }: AttachedDirTreeProps): React.ReactElement {
  const expandedStateKey = getAttachedDirectoryStateKey(sessionId, scope, dirPath)
  const [expanded, setExpanded] = useFileTreeExpanded(expandedStateKey, dirPath)
  const { children, loaded, error } = useAttachedDirectoryChildren({
    stateKey: expandedStateKey, path: dirPath, sessionId, allowedPaths,
    expanded, isDirectory: true, refreshVersion,
  })

  const dirName = dirPath.split(/[\\/]/).filter(Boolean).pop() || dirPath

  // 计算从 dirPath 到 revealTarget 之间的祖先目录集合（用于子项决定是否自动展开）
  const revealAncestors = React.useMemo(
    () => revealTarget ? computeRevealAncestors(dirPath, revealTarget) : new Set<string>(),
    [dirPath, revealTarget],
  )

  // 定位只发出展开意图；加载完成不得覆盖此后用户的收起操作。
  React.useEffect(() => {
    if (revealTs !== 0 && revealTarget) setExpanded(true)
  }, [revealTs, setExpanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (): void => { setExpanded((previous) => !previous) }

  // depth=0 的根行，与 FileBrowser 保持一致的布局：铺满、无外边距、可 sticky
  const { paddingLeft, guideLeft } = computeTreeRowLayout(0)
  const isSticky = expanded

  return (
    <div className="relative">
      <div
        data-sticky-row={isSticky ? 'true' : undefined}
        className={cn(
          'file-tree-row relative flex h-8 items-center gap-1 pr-2 text-sm cursor-pointer group',
          isSticky && cn(STICKY_ROW_BASE_CLASS, 'top-0 z-10'),
        )}
        style={{ paddingLeft }}
        onClick={toggleExpand}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          setFilePanelDragData(e.dataTransfer, [{
            path: dirPath,
            name: dirName,
            isDirectory: true,
            scope,
          }])
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-2 right-2 z-0 rounded-[17px] transition-colors',
            // sticky 行 hover 用不透明色，避免下方滚动内容透出；普通行保持半透明柔和感
            isSticky ? 'group-hover:bg-accent' : 'group-hover:bg-accent/50',
          )}
        />
        <ChevronRight
          className={cn(
            'relative z-10 size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        <FileTypeIcon name={dirName} isDirectory isOpen={expanded} className="relative z-10" />
        <span className="relative z-10 text-xs truncate flex-1" title={dirPath}>
          {dirName}
        </span>
        {showSessionBadge && scope === 'session' && (
          <span className="relative z-10 flex-shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">会话文件</span>
        )}
        {onOpenDirectoryTerminal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`在 ${dirName} 打开终端`}
                title={`在 ${dirName} 打开终端`}
                className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] hover:bg-accent/70 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.96]"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenDirectoryTerminal(dirPath, dirName)
                }}
              >
                <Terminal className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">在右侧标签中打开终端</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`解除附加目录 ${dirName}`}
              className="relative z-10 h-6 w-6 mr-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); onDetach() }}
            >
              <X className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">解除附加目录</TooltipContent>
        </Tooltip>
      </div>
      {expanded && (
        <div className="relative">
          <span
            aria-hidden="true"
            className="file-tree-guide pointer-events-none absolute bottom-1 top-0 w-px bg-border/70"
            style={{ left: guideLeft }}
          />
          {(error || (children.length === 0 && loaded)) && (
            <div
              className="text-[11px] text-muted-foreground/50 py-1"
              style={{ paddingLeft: paddingLeft + 24 }}
            >
              {error ?? '空文件夹'}
            </div>
          )}
          {children.map((child) => (
            <AttachedDirItem key={child.path} expandedStateKey={expandedStateKey} entry={child} depth={1} selectedPaths={selectedPaths} onSelect={onSelect} refreshVersion={refreshVersion} onAddToChat={onAddToChat} onFilePreview={onFilePreview} onOpenDirectoryTerminal={onOpenDirectoryTerminal} allowedPaths={allowedPaths} sessionId={sessionId} scope={scope} revealTarget={revealTarget} revealTs={revealTs} revealAncestors={revealAncestors} />
          ))}
        </div>
      )}
    </div>
  )
}

interface AttachedDirItemProps {
  expandedStateKey: string
  entry: FileEntry
  depth: number
  selectedPaths: Set<string>
  onSelect: (path: string, ctrlKey: boolean) => void
  refreshVersion: number
  onAddToChat?: (entry: FileEntry) => void
  onFilePreview?: (filePath: string) => void
  onOpenDirectoryTerminal?: (directoryPath: string, directoryName: string) => void
  allowedPaths?: string[]
  sessionId: string
  scope: 'project' | 'session'
  /** 自动定位目标路径，命中则滚动到中心 */
  revealTarget?: string | null
  /** 自动定位脉冲时间戳，变化时重新触发 */
  revealTs?: number
  /** 祖先目录集合，命中则自动展开 */
  revealAncestors?: Set<string>
}

function AttachedDirItem({ expandedStateKey, entry, depth, selectedPaths, onSelect, refreshVersion, onAddToChat, onFilePreview, onOpenDirectoryTerminal, allowedPaths, sessionId, scope, revealTarget = null, revealTs = 0, revealAncestors }: AttachedDirItemProps): React.ReactElement {
  // 重命名状态
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(entry.name)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  // 当前显示的名称和路径（重命名后更新）
  const [currentName, setCurrentName] = React.useState(entry.name)
  const [currentPath, setCurrentPath] = React.useState(entry.path)
  const [expanded, setExpanded, relocateExpandedPath] = useFileTreeExpanded(expandedStateKey, currentPath)
  const { children, loaded, error } = useAttachedDirectoryChildren({
    stateKey: expandedStateKey, path: currentPath, sessionId, allowedPaths,
    expanded, isDirectory: entry.isDirectory, refreshVersion,
  })
  const rowRef = React.useRef<HTMLDivElement>(null)

  const isSelected = selectedPaths.has(currentPath)

  // 同一个定位脉冲只展开一次，目录加载与用户手动折叠不重放定位。
  React.useEffect(() => {
    if (revealTs === 0 || !revealTarget || !entry.isDirectory) return
    if (revealAncestors?.has(currentPath) || currentPath === revealTarget) setExpanded(true)
  }, [revealTs, currentPath, setExpanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrolledRevealTsRef = React.useRef(0)
  React.useEffect(() => {
    if (revealTs === 0 || currentPath !== revealTarget || scrolledRevealTsRef.current === revealTs) return
    if (entry.isDirectory && (!expanded || !loaded)) return
    const frame = requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrolledRevealTsRef.current = revealTs
    })
    return () => { cancelAnimationFrame(frame) }
  }, [revealTs, revealTarget, currentPath, entry.isDirectory, expanded, loaded])

  const toggleDir = (): void => {
    if (entry.isDirectory) setExpanded((previous) => !previous)
  }

  const handleClick = (e: React.MouseEvent): void => {
    const isMulti = e.ctrlKey || e.metaKey
    onSelect(currentPath, isMulti)
    if (isMulti) return
    if (entry.isDirectory) {
      void toggleDir()
    } else {
      onFilePreview?.(currentPath)
    }
  }

  // 开始重命名
  const startRename = (): void => {
    setRenameValue(currentName)
    setIsRenaming(true)
    // 延迟聚焦，等待 DOM 渲染
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  // 确认重命名
  const confirmRename = async (): Promise<void> => {
    const newName = renameValue.trim()
    if (!newName || newName === currentName) {
      setIsRenaming(false)
      return
    }
    try {
      await window.electronAPI.renameAttachedFile(currentPath, newName, { sessionId, candidateBasePaths: allowedPaths })
      // 更新本地显示
      const parentDir = getPathDirname(currentPath)
      const newPath = joinPath(parentDir, newName)
      // 先迁移展开记录，再切换路径；子目录由新 identity 重新加载。
      if (entry.isDirectory) relocateExpandedPath(newPath)
      // 更新选中状态中的路径
      onSelect(newPath, false)
      setCurrentName(newName)
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 重命名失败:', err)
    }
    setIsRenaming(false)
  }

  // 取消重命名
  const cancelRename = (): void => {
    setIsRenaming(false)
    setRenameValue(currentName)
  }

  // 移动到文件夹
  const handleMove = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return
      await window.electronAPI.moveAttachedFile(currentPath, result.path, { sessionId, candidateBasePaths: allowedPaths })
      // 移动后更新路径
      const newPath = joinPath(result.path, currentName)
      if (entry.isDirectory) relocateExpandedPath(newPath)
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 移动失败:', err)
    }
  }

  const { paddingLeft, guideLeft, stickyTop, stickyZIndex } = computeTreeRowLayout(depth)
  const isSticky = entry.isDirectory && expanded && canBeSticky(depth)

  return (
    <>
      <div
        ref={rowRef}
        data-sticky-row={isSticky ? 'true' : undefined}
        className={cn(
          'file-tree-row relative flex h-8 items-center gap-1 pr-2 text-sm cursor-pointer group',
          isSticky && STICKY_ROW_BASE_CLASS,
        )}
        style={{
          paddingLeft,
          top: isSticky ? stickyTop : undefined,
          zIndex: isSticky ? stickyZIndex : undefined,
        }}
        onClick={handleClick}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.stopPropagation()
          setFilePanelDragData(e.dataTransfer, [{
            path: currentPath,
            name: currentName,
            isDirectory: entry.isDirectory,
            scope,
          }])
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-2 right-2 z-0 rounded-[17px] transition-colors',
            // sticky 行 hover 用不透明色，避免下方滚动内容透出；普通行保持半透明柔和感
            isSelected
              ? 'bg-accent'
              : isSticky
                ? 'group-hover:bg-accent'
                : 'group-hover:bg-accent/50',
          )}
        />
        {/* sticky 行祖先链竖线，逻辑见 tree-row-layout.tsx 的 AncestorGuides。
            选中态下 bg-accent 不透明背景会盖住原 border 色，组件内部已切到 accent-foreground。 */}
        {isSticky && <AncestorGuides depth={depth} isSelected={isSelected} />}
        {entry.isDirectory ? (
          <ChevronRight
            className={cn(
              'relative z-10 size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
        ) : (
          <span className="relative z-10 w-3.5 flex-shrink-0" />
        )}
        <FileTypeIcon name={currentName} isDirectory={entry.isDirectory} isOpen={expanded} className="relative z-10" />

        {/* 名称：正常显示 / 重命名输入框 */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="relative z-10 text-xs flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0.5 outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') cancelRename()
              e.stopPropagation()
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="relative z-10 truncate text-xs flex-1">{currentName}</span>
        )}

        {entry.isDirectory && onOpenDirectoryTerminal && !isRenaming && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`在 ${currentName} 打开终端`}
                title={`在 ${currentName} 打开终端`}
                className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] hover:bg-accent/70 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.96]"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenDirectoryTerminal(currentPath, currentName)
                }}
              >
                <Terminal className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">在右侧标签中打开终端</TooltipContent>
          </Tooltip>
        )}

        {/* 右侧操作按钮占位 */}
        <div
          className="relative z-10 flex-shrink-0 mr-1"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* 悬浮/选中状态：三点菜单 */}
          {!isRenaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'h-6 w-6 rounded flex items-center justify-center hover:bg-accent/70 text-muted-foreground hover:text-foreground',
                  !isSelected && 'invisible group-hover:visible focus-visible:visible data-[state=open]:visible',
                )}
                title="更多操作"
                aria-label="更多操作"
                onClick={() => {
                  if (!isSelected) onSelect(currentPath, false)
                }}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={() => dispatchInsertFileMention([{
                    path: currentPath,
                    name: currentName,
                    isDirectory: entry.isDirectory,
                    scope,
                  }])}
                >
                  <MessageSquarePlus />
                  引用到 Agent
                </DropdownMenuItem>
                {onAddToChat && !entry.isDirectory && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => onAddToChat({ ...entry, path: currentPath, name: currentName })}
                  >
                    <MessageSquarePlus />
                    添加到聊天
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={() => window.electronAPI.showAttachedInFolder(currentPath, { sessionId, candidateBasePaths: allowedPaths }).catch(console.error)}
                >
                  <FolderSearch />
                  在文件夹中显示
                </DropdownMenuItem>
                {!entry.isDirectory && onFilePreview && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => onFilePreview(currentPath)}
                  >
                    <ExternalLink />
                    打开文件
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={startRename}
                >
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={handleMove}
                >
                  <FolderInput />
                  移动到...
                </DropdownMenuItem>
              </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>
      {expanded && (
        <div className="relative">
          <span
            aria-hidden="true"
            className="file-tree-guide pointer-events-none absolute bottom-1 top-0 w-px bg-border/70"
            style={{ left: guideLeft }}
          />
          {(error || (children.length === 0 && loaded)) && (
            <div
              className="text-[11px] text-muted-foreground/50 py-1"
              style={{ paddingLeft: paddingLeft + 24 }}
            >
              {error ?? '空文件夹'}
            </div>
          )}
          {children.map((child) => (
            <AttachedDirItem key={child.path} expandedStateKey={expandedStateKey} entry={child} depth={depth + 1} selectedPaths={selectedPaths} onSelect={onSelect} refreshVersion={refreshVersion} onAddToChat={onAddToChat} onFilePreview={onFilePreview} onOpenDirectoryTerminal={onOpenDirectoryTerminal} allowedPaths={allowedPaths} sessionId={sessionId} scope={scope} revealTarget={revealTarget} revealTs={revealTs} revealAncestors={revealAncestors} />
          ))}
        </div>
      )}
    </>
  )
}

// Terminal panes mount only the visible terminal so two distinct terminal tabs can render side by side.
