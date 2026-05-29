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
import { Search, X, MessageSquare, Bot, Archive, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
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
import type {
  ChatMessage,
  MessageSearchResult,
  AgentMessageSearchResult,
  SDKMessage,
  SDKAssistantMessage,
  SDKSystemMessage,
  SDKUserMessage,
  SDKContentBlock,
  SDKUserContentBlock,
} from '@proma/shared'

/** 标题搜索结果项 */
interface TitleResult {
  id: string
  title: string
  type: 'chat' | 'agent'
  archived?: boolean
  updatedAt: number
}

/** 内容搜索结果项（统一格式） */
interface ContentResult {
  id: string
  title: string
  type: 'chat' | 'agent'
  messageId: string
  snippet: string
  matchStart: number
  matchLength: number
  archived?: boolean
}

type SearchResult = TitleResult | ContentResult

interface SearchPreviewTarget {
  result: SearchResult
}

interface SessionPreviewItem {
  id: string
  role: 'user' | 'assistant' | 'status'
  preview: string
  matched: boolean
}

interface SearchResultSessionPreviewProps {
  target: SearchPreviewTarget | null
  committedQuery: string
}

function isContentResult(result: SearchResult): result is ContentResult {
  return 'snippet' in result
}

/** 高亮文本中的匹配部分 */
function HighlightText({ text, query }: { text: string; query: string }): React.ReactElement {
  if (!query) return <>{text}</>

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  let idx = lowerText.indexOf(lowerQuery)
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx))
    }
    parts.push(
      <mark key={idx} className="bg-primary/20 text-foreground rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
    )
    lastIndex = idx + query.length
    idx = lowerText.indexOf(lowerQuery, lastIndex)
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
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
    <>
      {before}
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{match}</mark>
      {after}
    </>
  )
}

function SearchResultIcon({ result }: { result: SearchResult }): React.ReactElement {
  return result.type === 'chat' ? (
    <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
  ) : (
    <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
  )
}

function normalizePreviewText(text: string): string {
  return text
    .replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/g, '')
    .replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sdkBlockText(block: SDKContentBlock | SDKUserContentBlock): string {
  if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
    return block.text
  }
  if (block.type === 'thinking' && 'thinking' in block && typeof block.thinking === 'string') {
    return block.thinking
  }
  if (block.type === 'tool_use' && 'name' in block && typeof block.name === 'string') {
    const toolName = block.name || 'tool'
    return `调用工具 ${toolName}`
  }
  if (block.type === 'tool_result') {
    return block.is_error ? '工具结果出错' : '工具返回结果'
  }
  return ''
}

function buildChatPreviewItems(messages: ChatMessage[], matchMessageId?: string): SessionPreviewItem[] {
  return messages
    .map((message) => ({
      id: message.id,
      role: message.role === 'user' ? 'user' as const : message.role === 'assistant' ? 'assistant' as const : 'status' as const,
      preview: normalizePreviewText(message.content).slice(0, 220),
      matched: message.id === matchMessageId,
    }))
    .filter((item) => item.preview.length > 0)
}

function buildAgentPreviewItems(messages: SDKMessage[], matchMessageId?: string): SessionPreviewItem[] {
  const items: SessionPreviewItem[] = []

  for (const message of messages) {
    if (message.type === 'assistant') {
      const assistant = message as SDKAssistantMessage
      const blocks = Array.isArray(assistant.message?.content) ? assistant.message.content : []
      const preview = normalizePreviewText(blocks.map(sdkBlockText).filter(Boolean).join(' ')).slice(0, 220)
      if (preview) {
        items.push({
          id: assistant.uuid ?? `assistant-${items.length}`,
          role: 'assistant',
          preview,
          matched: assistant.uuid === matchMessageId,
        })
      }
      continue
    }

    if (message.type === 'user') {
      const user = message as SDKUserMessage
      const blocks = Array.isArray(user.message?.content) ? user.message.content : []
      const preview = normalizePreviewText(blocks.map(sdkBlockText).filter(Boolean).join(' ')).slice(0, 220)
      if (preview) {
        items.push({
          id: user.uuid ?? `user-${items.length}`,
          role: 'user',
          preview,
          matched: user.uuid === matchMessageId,
        })
      }
      continue
    }

    if (message.type === 'system') {
      const system = message as SDKSystemMessage
      const preview = system.subtype === 'compact_boundary'
        ? '上下文已压缩'
        : system.subtype === 'compacting'
          ? '正在压缩上下文...'
          : system.subtype === 'permission_denied'
            ? '自动审批已拒绝操作'
            : ''
      if (preview) {
        items.push({
          id: `${system.subtype ?? 'system'}-${items.length}`,
          role: 'status',
          preview,
          matched: false,
        })
      }
    }
  }

  return items
}

function SearchResultSessionPreview({ target, committedQuery }: SearchResultSessionPreviewProps): React.ReactElement | null {
  const [items, setItems] = React.useState<SessionPreviewItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const cacheRef = React.useRef<Map<string, SessionPreviewItem[]>>(new Map())

  React.useEffect(() => {
    if (!target) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }

    const key = `${target.result.type}:${target.result.id}:${isContentResult(target.result) ? target.result.messageId : 'title'}`
    const cached = cacheRef.current.get(key)
    if (cached) {
      setItems(cached)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const load = async (): Promise<void> => {
      try {
        const matchMessageId = isContentResult(target.result) ? target.result.messageId : undefined
        const nextItems = target.result.type === 'chat'
          ? buildChatPreviewItems(await window.electronAPI.getConversationMessages(target.result.id), matchMessageId)
          : buildAgentPreviewItems(await window.electronAPI.getAgentSessionSDKMessages(target.result.id), matchMessageId)
        if (cancelled) return
        cacheRef.current.set(key, nextItems)
        setItems(nextItems)
      } catch (loadError) {
        console.error('[搜索] 会话迷你地图加载失败:', loadError)
        if (!cancelled) setError('无法加载会话内容')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [target])

  if (!target) return null

  const matchedIndex = items.findIndex((item) => item.matched)

  return (
    <div className="absolute right-2 top-2 bottom-2 z-20 w-[286px] pointer-events-none">
      <div className="h-full max-h-[380px] rounded-lg border bg-popover shadow-xl overflow-hidden pointer-events-auto animate-in fade-in-0 zoom-in-95 duration-150">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <div className="min-w-0 flex items-center gap-2">
            <SearchResultIcon result={target.result} />
            <span className="truncate text-xs font-medium text-popover-foreground/75">
              {target.result.title}
            </span>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {loading ? '加载中' : `${items.length} 条`}
          </span>
        </div>

        <div className="max-h-[336px] overflow-y-auto scrollbar-thin p-2">
          {loading && (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              <span>正在读取会话...</span>
            </div>
          )}

          {!loading && error && (
            <div className="py-8 text-center text-xs text-muted-foreground">{error}</div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">暂无可预览内容</div>
          )}

          {!loading && !error && items.length > 0 && (
            <div className="space-y-1">
              {items.map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-1.5 py-1.5',
                    item.matched && 'bg-primary/10'
                  )}
                >
                  <div className="relative mt-1 w-7 shrink-0">
                    <div
                      className={cn(
                        'h-[3px] rounded-full',
                        item.matched
                          ? 'bg-primary'
                          : item.role === 'user'
                            ? 'bg-primary/35'
                            : item.role === 'assistant'
                              ? 'bg-blue-500/35'
                              : 'bg-foreground/20'
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[11px] leading-4 text-popover-foreground/70">
                      <HighlightText text={item.preview} query={committedQuery} />
                    </div>
                  </div>
                </div>
              ))}
              {matchedIndex >= 0 && (
                <div className="pt-1 text-center text-[10px] text-muted-foreground">
                  已定位到第 {matchedIndex + 1} 条匹配消息
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SearchDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(searchDialogOpenAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const channels = useAtomValue(channelsAtom)
  const currentAgentChannelId = useAtomValue(agentChannelIdAtom)
  const setAgentPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()
  const { createAgent } = useCreateSession()

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
  const [previewTarget, setPreviewTarget] = React.useState<SearchPreviewTarget | null>(null)
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

  const handleClearQuery = React.useCallback(() => {
    setQuery('')
    setCommittedQuery('')
    setTitleResults([])
    setContentResults([])
    setHasSearched(false)
    setSelectedIndex(0)
    setPreviewTarget(null)
    searchTokenRef.current += 1
    setLoading(false)
    inputRef.current?.focus()
  }, [])

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
      setPreviewTarget(null)
      return
    }

    const token = ++searchTokenRef.current
    setCommittedQuery(q)
    setHasSearched(true)
    setLoading(true)
    setSelectedIndex(0)
    setPreviewTarget(null)

    const qLower = q.toLowerCase()
    const titles: TitleResult[] = [
      ...conversations
        .filter((c) => c.title.toLowerCase().includes(qLower))
        .map((c) => ({ id: c.id, title: c.title, type: 'chat' as const, archived: c.archived, updatedAt: c.updatedAt })),
      ...agentSessions
        .filter((s) => s.title.toLowerCase().includes(qLower))
        .map((s) => ({ id: s.id, title: s.title, type: 'agent' as const, archived: s.archived, updatedAt: s.updatedAt })),
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)

    setTitleResults(titles)

    try {
      const [chatResults, agentResults] = await Promise.all([
        window.electronAPI.searchConversationMessages(q),
        window.electronAPI.searchAgentSessionMessages(q),
      ])
      if (token !== searchTokenRef.current) return

      const titleIds = new Set(titles.map((t) => t.id))
      const chatContent: ContentResult[] = (chatResults as MessageSearchResult[])
        .filter((r) => !titleIds.has(r.conversationId))
        .map((r) => ({
          id: r.conversationId,
          title: r.conversationTitle,
          type: 'chat' as const,
          messageId: r.messageId,
          snippet: r.snippet,
          matchStart: r.matchStart,
          matchLength: r.matchLength,
          archived: r.archived,
        }))
      const agentContent: ContentResult[] = (agentResults as AgentMessageSearchResult[])
        .filter((r) => !titleIds.has(r.sessionId))
        .map((r) => ({
          id: r.sessionId,
          title: r.sessionTitle,
          type: 'agent' as const,
          messageId: r.messageId,
          snippet: r.snippet,
          matchStart: r.matchStart,
          matchLength: r.matchLength,
          archived: r.archived,
        }))

      setContentResults([...chatContent, ...agentContent])
    } catch (error) {
      console.error('[搜索] 内容搜索失败:', error)
      if (token === searchTokenRef.current) setContentResults([])
    } finally {
      if (token === searchTokenRef.current) setLoading(false)
    }
  }, [query, conversations, agentSessions])

  const handleAgentSearch = React.useCallback(async () => {
    const q = query.trim()
    if (!q) return

    const deepseekChannel = channels.find(
      (c) => c.enabled && c.models.some((m) => m.id === 'deepseek-v4-flash' && m.enabled)
    )
    const channelId = deepseekChannel?.id ?? currentAgentChannelId ?? undefined

    const configDir = import.meta.env.DEV ? '.proma-dev' : '.proma'
    const prompt = `请帮我在 Proma 的全部会话历史中搜索与以下描述相关的内容：

"${q}"

搜索范围：
- Chat 会话消息文件：~/${configDir}/conversations/ 目录下所有 .jsonl 文件
- Agent 会话消息文件：~/${configDir}/agent-sessions/ 目录下所有 .jsonl 文件

要求：
1. 理解用户描述的语义，不要求关键词完全匹配，根据内容相关性判断
2. 找到相关会话后，给出会话标题、相关内容摘要，以及文件路径
3. 按相关性排序，最相关的结果排在最前面`

    const sessionId = await createAgent({ channelId })
    if (!sessionId) return

    setAgentPendingPrompt({ sessionId, message: prompt })
    setOpen(false)
    setActiveView('conversations')
  }, [query, channels, currentAgentChannelId, createAgent, setAgentPendingPrompt, setOpen, setActiveView])

  // 全部结果列表（标题在前、内容在后）
  const allResults = React.useMemo<SearchResult[]>(
    () => [...titleResults, ...contentResults],
    [titleResults, contentResults]
  )

  // 导航到对话/会话
  const navigateToResult = React.useCallback((result: TitleResult | ContentResult) => {
    setOpen(false)
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
  }, [setOpen, setActiveView, openSession, conversations, agentSessions])

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

  // 打开时重置状态并聚焦
  React.useEffect(() => {
    if (open) {
      searchTokenRef.current += 1
      setQuery('')
      setCommittedQuery('')
      setTitleResults([])
      setContentResults([])
      setHasSearched(false)
      setSelectedIndex(0)
      setPreviewTarget(null)
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const trimmedQuery = query.trim()
  const canSearch = trimmedQuery.length >= 2 && !loading
  const isQueryDirty = trimmedQuery !== committedQuery

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="sm:max-w-[520px] p-0 gap-0 overflow-hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">搜索对话</DialogTitle>
        {/* 搜索输入框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
          <Search size={16} className="text-foreground/40 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            placeholder="输入关键词，按 Enter 或点击搜索"
            className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-foreground/40 outline-none"
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
              'flex items-center gap-1 px-2 py-1 rounded text-[12px] font-medium transition-colors',
              canSearch
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-foreground/[0.06] text-foreground/30 cursor-not-allowed'
            )}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            <span>搜索</span>
          </button>
          <button
            onClick={() => void handleAgentSearch()}
            disabled={trimmedQuery.length < 2}
            title="适合在精准搜索找不到的情况下使用，Agent 会帮助你搜索整个 Proma 会话空间"
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-[12px] font-medium transition-colors',
              trimmedQuery.length >= 2
                ? 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20'
                : 'bg-foreground/[0.06] text-foreground/30 cursor-not-allowed'
            )}
          >
            <Bot size={12} />
            <span>Agent 搜索</span>
          </button>
        </div>

        {/* 搜索结果 */}
        <div
          className="relative"
          onMouseLeave={() => setPreviewTarget(null)}
        >
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
              <button
                onClick={() => void handleAgentSearch()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors"
              >
                <Bot size={12} />
                <span>试试 Agent 搜索</span>
              </button>
            </div>
          )}

          {/* 标题匹配区域 */}
          {titleResults.length > 0 && (
            <div className="py-1 animate-in fade-in duration-150">
              <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                标题匹配
              </div>
              {titleResults.map((result, idx) => (
                <button
                  key={`title-${result.id}`}
                  data-index={idx}
                  onClick={() => navigateToResult(result)}
                  onMouseEnter={() => {
                    setSelectedIndex(idx)
                    setPreviewTarget({ result })
                  }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors',
                    selectedIndex === idx
                      ? 'bg-primary/10'
                      : 'hover:bg-foreground/[0.04]',
                    result.archived && 'opacity-60'
                  )}
                >
                  <SearchResultIcon result={result} />
                  <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">
                    <HighlightText text={result.title} query={committedQuery} />
                  </span>
                  {result.type === 'agent' && (() => {
                    const wsName = getAgentWorkspaceName(result.id)
                    return wsName ? (
                      <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-foreground/[0.06] text-[10px] leading-4 text-foreground/40 font-medium truncate max-w-[80px]">
                        {wsName}
                      </span>
                    ) : null
                  })()}
                  {result.archived && (
                    <Archive size={12} className="flex-shrink-0 text-foreground/30" />
                  )}
                </button>
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
              {contentResults.map((result, i) => {
                const globalIdx = titleResults.length + i
                return (
                  <button
                    key={`content-${result.id}-${result.messageId}`}
                    data-index={globalIdx}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => {
                      setSelectedIndex(globalIdx)
                      setPreviewTarget({ result })
                    }}
                    className={cn(
                      'w-full flex flex-col gap-0.5 px-4 py-2 text-left transition-colors',
                      selectedIndex === globalIdx
                        ? 'bg-primary/10'
                        : 'hover:bg-foreground/[0.04]',
                      result.archived && 'opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <SearchResultIcon result={result} />
                      <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">
                        {result.title}
                      </span>
                      {result.type === 'agent' && (() => {
                        const wsName = getAgentWorkspaceName(result.id)
                        return wsName ? (
                          <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-foreground/[0.06] text-[10px] leading-4 text-foreground/40 font-medium truncate max-w-[80px]">
                            {wsName}
                          </span>
                        ) : null
                      })()}
                      {result.archived && (
                        <Archive size={12} className="flex-shrink-0 text-foreground/30" />
                      )}
                    </div>
                    <div className="pl-[22px] text-[12px] text-foreground/50 truncate">
                      <HighlightSnippet
                        snippet={result.snippet}
                        matchStart={result.matchStart}
                        matchLength={result.matchLength}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          </div>

          <SearchResultSessionPreview
            target={previewTarget}
            committedQuery={committedQuery}
          />
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
