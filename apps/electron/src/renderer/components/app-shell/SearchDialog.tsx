/**
 * SearchDialog - 全局搜索 Dialog
 *
 * 浮动搜索面板，支持：
 * - 手动触发搜索（点击搜索按钮 / 在输入框按 Enter）
 * - 标题匹配 + 消息内容匹配统一渲染，匹配文字高亮
 * - 键盘导航（上下箭头选择 + Enter 打开结果 + Esc 关闭）
 * - 同时搜索 Chat 和 Agent 模式
 *
 * 为什么手动触发：随着用户历史对话变多，自动搜索每次按键都会扫描全量 JSONL，
 * 主进程被 IO 阻塞导致整体卡顿。改成手动触发后只在用户确认意图时执行一次。
 *
 * Enter 键的双重语义：
 * - 已有搜索结果且选中项存在 → 打开选中的会话
 * - 否则（首次搜索、修改了查询词等） → 触发搜索
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Search, X, MessageSquare, Bot, Archive, Loader2, Folder, FolderOpen, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { SearchMatchHighlight } from './SearchMatchHighlight'
import {
  GLOBAL_SEARCH_SCOPE,
  updateMessageSearchNavigationAtom,
  searchDialogOpenAtom,
  searchScopeAtom,
} from '@/atoms/search-atoms'
import { conversationsAtom, channelsAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  agentWorkspacesAtom,
  agentChannelIdAtom,
  agentPendingPromptAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useCreateSession } from '@/hooks/useCreateSession'
import { sessionHoverPreviewEnabledAtom } from '@/atoms/ui-preferences'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
} from '@/components/session-preview/SessionMiniMapPopover'
import { findBestSearchMatch } from '@proma/shared'
import {
  buildSearchScopePlan,
  buildGlobalSearchRequest,
  createGlobalTitleResults,
  getGlobalSearchResultKey,
  mergeGlobalContentResults,
  type GlobalContentResult as ContentResult,
  type GlobalTitleResult as TitleResult,
} from '@/lib/global-search-results'
import { createMessageSearchNavigation } from '@/lib/message-search-navigation'
import {
  SEARCH_DIALOG_LAYERS,
  SEARCH_SCOPE_MENU_MODAL,
} from '@/lib/search-dialog-layering'

type SearchResult = TitleResult | ContentResult

function isContentResult(result: SearchResult): result is ContentResult {
  return 'snippet' in result
}

/** 高亮文本中的匹配部分 */
function HighlightText({ text, query }: { text: string; query: string }): React.ReactElement {
  const match = findBestSearchMatch(text, query)
  if (!match) return <>{text}</>

  const before = text.slice(0, match.matchStart)
  const matchedText = text.slice(match.matchStart, match.matchStart + match.matchLength)
  const after = text.slice(match.matchStart + match.matchLength)

  return (
    <SearchMatchHighlight before={before} match={matchedText} after={after} />
  )
}

/** 高亮 snippet 中的匹配部分（使用预计算位置） */
function HighlightSnippet({ snippet, matchStart, matchLength }: {
  snippet: string
  matchStart: number
  matchLength: number
}): React.ReactElement {
  if (matchStart < 0 || matchStart >= snippet.length) return <>{snippet}</>

  const before = snippet.slice(0, matchStart)
  const match = snippet.slice(matchStart, matchStart + matchLength)
  const after = snippet.slice(matchStart + matchLength)

  return (
    <SearchMatchHighlight before={before} match={match} after={after} />
  )
}

function SearchResultIcon({ result }: { result: SearchResult }): React.ReactElement {
  return result.type === 'chat' ? (
    <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
  ) : (
    <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
  )
}

interface SearchResultRowProps {
  result: SearchResult
  index: number
  isSelected: boolean
  committedQuery: string
  miniMapDisabled?: boolean
  getAgentWorkspaceName: (sessionId: string) => string | undefined
  onSelect: (result: SearchResult) => void
  onHover: (index: number) => void
}

function SearchResultRow({
  result,
  index,
  isSelected,
  committedQuery,
  miniMapDisabled,
  getAgentWorkspaceName,
  onSelect,
  onHover,
}: SearchResultRowProps): React.ReactElement {
  const preview = useSessionMiniMapHover(400, miniMapDisabled)
  const isContent = isContentResult(result)
  const wsName = result.type === 'agent' ? getAgentWorkspaceName(result.id) : undefined

  return (
    <>
      <button
        ref={preview.setAnchorRef}
        data-index={index}
        onClick={() => onSelect(result)}
        onMouseEnter={() => {
          onHover(index)
          preview.handleMouseEnter()
        }}
        onMouseLeave={preview.handleMouseLeave}
        className={cn(
          'w-full px-4 py-2 text-left transition-colors',
          isContent ? 'flex flex-col gap-0.5' : 'flex items-center gap-2.5',
          isSelected
            ? 'bg-primary/10'
            : 'hover:bg-foreground/[0.04]',
          result.archived && 'opacity-60'
        )}
      >
        <div className="flex items-center gap-2.5">
          <SearchResultIcon result={result} />
          <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">
            {isContent ? result.title : <HighlightText text={result.title} query={committedQuery} />}
          </span>
          {wsName && (
            <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-foreground/[0.06] text-[10px] leading-4 text-foreground/40 font-medium truncate max-w-[80px]">
              {wsName}
            </span>
          )}
          {result.archived && (
            <Archive size={12} className="flex-shrink-0 text-foreground/30" />
          )}
        </div>
        {isContent && (
          <div className="pl-[22px] text-[12px] text-foreground/50 truncate">
            <HighlightSnippet
              snippet={result.snippet}
              matchStart={result.matchStart}
              matchLength={result.matchLength}
            />
          </div>
        )}
      </button>
      <SessionMiniMapPopover
        target={{
          type: result.type,
          sessionId: result.id,
          title: result.title,
          workspaceName: wsName,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </>
  )
}

export function SearchDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(searchDialogOpenAtom)
  const [searchScope, setSearchScope] = useAtom(searchScopeAtom)
  const updateMessageSearchNavigation = useSetAtom(updateMessageSearchNavigationAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const channels = useAtomValue(channelsAtom)
  const currentAgentChannelId = useAtomValue(agentChannelIdAtom)
  const setAgentPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()
  const { createAgent } = useCreateSession()
  const isProjectSearch = searchScope.kind === 'project'

  const workspaceNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const w of agentWorkspaces) map.set(w.id, w.name)
    return map
  }, [agentWorkspaces])

  const getAgentWorkspaceName = React.useCallback((sessionId: string): string | undefined => {
    const session = agentSessions.find((s) => s.id === sessionId)
    if (!session?.workspaceId) return undefined
    return workspaceNameMap.get(session.workspaceId)
  }, [agentSessions, workspaceNameMap])

  // query：输入框当前值（实时跟随用户）
  // committedQuery：用户已确认提交的搜索词（点击/回车后才更新），用于结果展示与高亮
  const [query, setQuery] = React.useState('')
  const [committedQuery, setCommittedQuery] = React.useState('')
  const [titleResults, setTitleResults] = React.useState<TitleResult[]>([])
  const [contentResults, setContentResults] = React.useState<ContentResult[]>([])
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = React.useState<string[]>([])
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const isComposingRef = React.useRef(false)
  // 用 ref 持有当前请求的 token，发起新请求时使旧请求结果作废
  const searchTokenRef = React.useRef(0)

  const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
  }, [])

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = React.useCallback(() => {
    isComposingRef.current = false
  }, [])

  const resetSearchResults = React.useCallback(() => {
    setCommittedQuery('')
    setTitleResults([])
    setContentResults([])
    setHasSearched(false)
    setSelectedIndex(0)
    searchTokenRef.current += 1
    setLoading(false)
  }, [])

  const handleClearQuery = React.useCallback(() => {
    setQuery('')
    resetSearchResults()
    inputRef.current?.focus()
  }, [resetSearchResults])

  const handleWorkspaceCheckedChange = React.useCallback((workspaceId: string, checked: boolean) => {
    setSelectedWorkspaceIds((current) => checked
      ? [...new Set([...current, workspaceId])]
      : current.filter((id) => id !== workspaceId))
    resetSearchResults()
  }, [resetSearchResults])

  const handleSelectAllWorkspaces = React.useCallback(() => {
    setSelectedWorkspaceIds([])
    resetSearchResults()
  }, [resetSearchResults])

  /**
   * 执行一次搜索：标题前端过滤 + 内容主进程 IPC 并行调用。
   *
   * 通过 token 隔离多次手动触发——若用户在搜索进行中再次触发，旧 token 的结果会被丢弃。
   */
  const runSearch = React.useCallback(async () => {
    const q = query.trim()
    if (!q || q.length < 2) {
      setTitleResults([])
      setContentResults([])
      setHasSearched(false)
      setCommittedQuery('')
      return
    }

    const token = ++searchTokenRef.current
    setCommittedQuery(q)
    setHasSearched(true)
    setLoading(true)
    setSelectedIndex(0)

    const scopePlan = buildSearchScopePlan({
      projectWorkspaceId: isProjectSearch ? searchScope.workspaceId : undefined,
      selectedWorkspaceIds,
    })
    const request = buildGlobalSearchRequest(scopePlan.workspaceIds)
    const titles = scopePlan.includeTitleMatches
      ? createGlobalTitleResults({
        query: q,
        conversations,
        agentSessions,
        selectedWorkspaceIds,
      })
      : []

    setTitleResults(titles)

    try {
      const [chatResults, agentResults] = await Promise.all([
        request.includeChat ? window.electronAPI.searchConversationMessages(q) : Promise.resolve([]),
        window.electronAPI.searchAgentSessionMessages(q, request.agentOptions),
      ])
      if (token !== searchTokenRef.current) return

      const titleResultKeys = new Set(titles.map((result) => getGlobalSearchResultKey(result.type, result.id)))
      setContentResults(mergeGlobalContentResults({
        query: q,
        titleResultKeys,
        chatResults,
        agentResults,
      }))
    } catch (error) {
      console.error('[搜索] 内容搜索失败:', error)
      if (token === searchTokenRef.current) setContentResults([])
    } finally {
      if (token === searchTokenRef.current) setLoading(false)
    }
  }, [query, conversations, agentSessions, selectedWorkspaceIds, isProjectSearch, searchScope])

  const handleAgentSearch = React.useCallback(async () => {
    const q = query.trim()
    if (!q) return

    const deepseekChannel = channels.find(
      (c) => c.enabled && c.models.some((m) => m.id === 'deepseek-v4-flash' && m.enabled)
    )
    const channelId = deepseekChannel?.id ?? currentAgentChannelId ?? undefined

    const configDir = import.meta.env.DEV ? '.proma-dev' : '.proma'
    const selectedWorkspaceIdSet = new Set(selectedWorkspaceIds)
    const selectedWorkspaces = agentWorkspaces.filter((workspace) => selectedWorkspaceIdSet.has(workspace.id))
    const selectedSessionIds = agentSessions
      .filter((session) => session.workspaceId && selectedWorkspaceIdSet.has(session.workspaceId))
      .map((session) => session.id)
    const scopeDescription = selectedWorkspaces.length === 0
      ? `- Chat 会话消息文件：~/${configDir}/conversations/ 目录下所有 .jsonl 文件
- Agent 会话消息文件：~/${configDir}/agent-sessions/ 目录下所有 .jsonl 文件`
      : `- 仅搜索 Agent 项目：${selectedWorkspaces.map((workspace) => workspace.name).join('、')}
- 允许搜索的会话文件名：${selectedSessionIds.length > 0 ? selectedSessionIds.map((id) => `${id}.jsonl`).join('、') : '当前所选项目暂无会话'}
- Agent 会话消息目录：~/${configDir}/agent-sessions/`
    const prompt = `请帮我在 Proma 的会话历史中搜索与以下描述相关的内容：

"${q}"

搜索范围：
${scopeDescription}

要求：
1. 理解用户描述的语义，不要求关键词完全匹配，根据内容相关性判断
2. 找到相关会话后，给出会话标题、相关内容摘要，以及文件路径
3. 按相关性排序，最相关的结果排在最前面`

    const sessionId = await createAgent({ channelId })
    if (!sessionId) return

    setAgentPendingPrompt({ sessionId, message: prompt })
    setOpen(false)
    setSearchScope(GLOBAL_SEARCH_SCOPE)
    setActiveView('conversations')
  }, [query, channels, currentAgentChannelId, createAgent, setAgentPendingPrompt, setOpen, setSearchScope, setActiveView, selectedWorkspaceIds, agentWorkspaces, agentSessions])

  // 全部结果列表（标题在前、内容在后）
  const allResults = React.useMemo<SearchResult[]>(
    () => [...titleResults, ...contentResults],
    [titleResults, contentResults]
  )

  // 导航到对话/会话
  const navigateToResult = React.useCallback((result: TitleResult | ContentResult) => {
    updateMessageSearchNavigation(isContentResult(result)
      ? { type: 'request', navigation: createMessageSearchNavigation(result, committedQuery) }
      : { type: 'clear' })
    setOpen(false)
    setSearchScope(GLOBAL_SEARCH_SCOPE)
    setActiveView('conversations')

    if (result.type === 'chat') {
      const conv = conversations.find((c) => c.id === result.id)
      const title = conv?.title ?? result.title
      openSession('chat', result.id, title)
    } else {
      const session = agentSessions.find((s) => s.id === result.id)
      const title = session?.title ?? result.title
      openSession('agent', result.id, title)
    }
  }, [updateMessageSearchNavigation, committedQuery, setOpen, setSearchScope, setActiveView, openSession, conversations, agentSessions])

  const handleOpenChange = React.useCallback((nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (!nextOpen) setSearchScope(GLOBAL_SEARCH_SCOPE)
  }, [setOpen, setSearchScope])

  /**
   * Enter 键语义：
   * - 输入法 composition 中 → 让浏览器处理（确认候选词），不做任何事
   * - 用户改了搜索词、或还没搜过 → 触发搜索
   * - 否则（搜索词未变且有结果）→ 打开当前选中项
   */
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (isComposingRef.current) return
      e.preventDefault()
      const trimmed = query.trim()
      const isQueryDirty = trimmed !== committedQuery
      if (isQueryDirty || !hasSearched) {
        void runSearch()
      } else if (allResults[selectedIndex]) {
        navigateToResult(allResults[selectedIndex]!)
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    }
  }, [query, committedQuery, hasSearched, allResults, selectedIndex, runSearch, navigateToResult])

  // 自动滚动选中项到可视区域
  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // 打开或切换搜索范围时重置状态，避免项目结果残留到全局搜索（反向亦然）。
  React.useEffect(() => {
    if (open) {
      updateMessageSearchNavigation({ type: 'clear' })
      setQuery('')
      setSelectedWorkspaceIds([])
      resetSearchResults()
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, searchScope, resetSearchResults, updateMessageSearchNavigation])

  const trimmedQuery = query.trim()
  const canSearch = trimmedQuery.length >= 2 && !loading
  const isQueryDirty = trimmedQuery !== committedQuery

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={false}>
      {/* 非交互式背景遮罩：modal=false 时 Radix 不渲染原生 overlay（避免拦截 hover 预览的事件），
       * 这里手动通过 DialogPortal 在 document.body 渲染一个 pointer-events-none 的 blur 层——
       * Portal 是关键：直接渲染会被父级 stacking context（如 MainContentPanel）困住，导致只覆盖到
       * 左侧栏；用 Portal 后 fixed inset-0 真正覆盖整个视口。
       * z-[99] 在 DialogContent (z-[100]) 之下，在所有 app 内容之上。
       */}
      {open && (
        <DialogPortal>
          <div
            aria-hidden
            className="fixed inset-0 bg-black/40 pointer-events-none animate-in fade-in-0 duration-150"
            style={{ zIndex: SEARCH_DIALOG_LAYERS.overlay }}
          />
        </DialogPortal>
      )}
      <DialogContent
        hideClose
        className="w-[min(720px,calc(100vw_-_32px))] sm:max-w-[720px] p-0 gap-0 overflow-hidden"
        style={{ zIndex: SEARCH_DIALOG_LAYERS.dialog }}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          {isProjectSearch ? `搜索项目 ${searchScope.workspaceName}` : '搜索对话'}
        </DialogTitle>
        {/* 搜索输入框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
          <Search size={16} className="text-foreground/40 flex-shrink-0" />
          {isProjectSearch && (
            <span
              className="flex max-w-[180px] shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[12px] text-foreground/65"
              title={`搜索项目：${searchScope.workspaceName}`}
            >
              <FolderOpen size={12} className="shrink-0 text-primary/70" />
              <span className="truncate">{searchScope.workspaceName}</span>
            </span>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            placeholder={isProjectSearch ? '搜索此项目下的所有 Session' : '输入关键词，按 Enter 或点击搜索'}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-foreground/40 outline-none"
          />
          {query && (
            <button
              onClick={handleClearQuery}
              title="清空"
              className="p-0.5 rounded text-foreground/30 hover:text-foreground/60 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => void runSearch()}
            disabled={!canSearch}
            className={cn(
              'flex shrink-0 items-center gap-1 px-2 py-1 rounded text-[12px] font-medium transition-colors',
              canSearch
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-foreground/[0.06] text-foreground/30 cursor-not-allowed'
            )}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            <span>搜索</span>
          </button>
          {!isProjectSearch && (
            <button
              onClick={() => void handleAgentSearch()}
              disabled={trimmedQuery.length < 2}
              title="适合在精准搜索找不到的情况下使用，Agent 会帮助你搜索整个 Proma 会话空间"
              className={cn(
                'flex shrink-0 items-center gap-1 px-2 py-1 rounded text-[12px] font-medium transition-colors',
                trimmedQuery.length >= 2
                  ? 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20'
                  : 'bg-foreground/[0.06] text-foreground/30 cursor-not-allowed'
              )}
            >
              <Bot size={12} />
              <span>Agent 搜索</span>
            </button>
          )}
        </div>

        {/* 项目范围：不选择时搜索 Chat 与全部 Agent，选择后仅搜索对应 Agent 项目。 */}
        {!isProjectSearch && agentWorkspaces.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2">
            <span className="text-[11px] text-foreground/40">搜索范围</span>
            <DropdownMenu modal={SEARCH_SCOPE_MENU_MODAL}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 max-w-[280px] items-center gap-1.5 rounded-md bg-foreground/[0.05] px-2 py-1 text-[12px] text-foreground/65 transition-colors hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="选择全局搜索项目范围"
                >
                  <Folder size={12} className="shrink-0" />
                  <span className="truncate">
                    {selectedWorkspaceIds.length === 0 ? '全部项目' : `已选 ${selectedWorkspaceIds.length} 个项目`}
                  </span>
                  <ChevronDown size={12} className="shrink-0 text-foreground/35" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-[320px] min-w-[240px]"
                style={{ zIndex: SEARCH_DIALOG_LAYERS.scopeMenu }}
              >
                <DropdownMenuLabel className="text-[11px] text-foreground/45">选择一个或多个项目</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={selectedWorkspaceIds.length === 0}
                  onCheckedChange={handleSelectAllWorkspaces}
                >
                  全部项目
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {agentWorkspaces.map((workspace) => (
                  <DropdownMenuCheckboxItem
                    key={workspace.id}
                    checked={selectedWorkspaceIds.includes(workspace.id)}
                    onCheckedChange={(checked) => handleWorkspaceCheckedChange(workspace.id, checked === true)}
                  >
                    <span className="truncate" title={workspace.name}>{workspace.name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="min-w-0 truncate text-[11px] text-foreground/35">
              {selectedWorkspaceIds.length === 0
                ? 'Chat 与全部 Agent 项目'
                : '仅搜索已选 Agent 项目'}
            </span>
          </div>
        )}

        {/* 搜索结果 */}
        <div className="relative">
          <div ref={listRef} className="max-h-[400px] overflow-y-auto scrollbar-thin">
          {!hasSearched && (
            <div className="py-12 text-center text-[13px] text-foreground/40">
              {trimmedQuery.length === 0
                ? '输入关键词后按 Enter 或点击搜索'
                : trimmedQuery.length < 2
                  ? '关键词至少需要 2 个字符'
                  : '按 Enter 或点击搜索开始查找'}
            </div>
          )}

          {hasSearched && loading && allResults.length === 0 && (
            <div className="py-12 flex items-center justify-center gap-2 text-[13px] text-foreground/40">
              <Loader2 size={14} className="animate-spin" />
              <span>正在搜索...</span>
            </div>
          )}

          {hasSearched && !loading && allResults.length === 0 && (
            <div className="py-8 flex flex-col items-center gap-3 text-[13px] text-foreground/40">
              <span>未找到匹配结果</span>
              {!isProjectSearch && (
                <button
                  onClick={() => void handleAgentSearch()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors"
                >
                  <Bot size={12} />
                  <span>试试 Agent 搜索</span>
                </button>
              )}
            </div>
          )}

          {/* 标题匹配区域 */}
          {titleResults.length > 0 && (
            <div className="py-1 animate-in fade-in duration-150">
              <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                标题匹配
              </div>
              {titleResults.map((result, idx) => (
                <SearchResultRow
                  key={`title-${result.id}`}
                  result={result}
                  index={idx}
                  isSelected={selectedIndex === idx}
                  committedQuery={committedQuery}
                  miniMapDisabled={!sessionHoverPreviewEnabled}
                  getAgentWorkspaceName={getAgentWorkspaceName}
                  onSelect={navigateToResult}
                  onHover={setSelectedIndex}
                />
              ))}
            </div>
          )}

          {/* 内容匹配区域 */}
          {(contentResults.length > 0 || (loading && hasSearched && titleResults.length > 0)) && (
            <div className="py-1 border-t border-border/30 animate-in fade-in duration-150">
              <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-[11px] font-medium text-foreground/40 select-none">
                <span>消息内容匹配</span>
                {loading && <Loader2 size={12} className="animate-spin text-foreground/30" />}
              </div>
              {contentResults.map((result, i) => (
                <SearchResultRow
                  key={`content-${result.id}-${result.messageId}`}
                  result={result}
                  index={titleResults.length + i}
                  isSelected={selectedIndex === titleResults.length + i}
                  committedQuery={committedQuery}
                  miniMapDisabled={!sessionHoverPreviewEnabled}
                  getAgentWorkspaceName={getAgentWorkspaceName}
                  onSelect={navigateToResult}
                  onHover={setSelectedIndex}
                />
              ))}
            </div>
          )}
          </div>
        </div>

        {/* 底部快捷键提示 */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[11px] text-foreground/30">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↵</kbd>
            <span>{isQueryDirty || !hasSearched ? '搜索' : '打开'}</span>
          </span>
          {allResults.length > 0 && (
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↑↓</kbd>
              <span>选择</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">Esc</kbd>
            <span>关闭</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
