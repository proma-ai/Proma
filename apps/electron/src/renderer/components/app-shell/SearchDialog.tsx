/**
 * SearchDialog - 全局搜索 Dialog
 *
 * 浮动搜索面板，支持：
 * - 即时标题匹配（纯前端过滤）
 * - 渐进式消息内容搜索（debounce 后 IPC 调用）
 * - 匹配文字高亮
 * - 键盘导航（上下箭头 + Enter + Esc）
 * - 同时搜索 Chat 和 Agent 模式
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Search, X, MessageSquare, Bot, Archive, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { conversationsAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useOpenSession } from '@/hooks/useOpenSession'
import type { ConversationMeta, AgentSessionMeta, MessageSearchResult, AgentMessageSearchResult } from '@proma/shared'

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
  snippet: string
  matchStart: number
  matchLength: number
  archived?: boolean
}

/**
 * 高亮文本中的匹配部分
 */
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

/**
 * 高亮 snippet 中的匹配部分（使用预计算位置）
 */
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

export function SearchDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(searchDialogOpenAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const openSession = useOpenSession()

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

  const [query, setQuery] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [contentResults, setContentResults] = React.useState<ContentResult[]>([])
  const [contentLoading, setContentLoading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const isComposingRef = React.useRef(false)
  const commitTimerRef = React.useRef<ReturnType<typeof setTimeout>>()

  /**
   * 提交搜索词（微 debounce 60ms）
   *
   * 为什么需要这一层：中文输入法下 compositionend 和 onChange 的触发顺序
   * 在 Chrome / Firefox / Safari 之间不一致。微 debounce 保证无论事件顺序如何，
   * 最终都能拿到用户确认后的完整文本，避免逐字输入时搜索结果跳动。
   * 60ms 对人眼不可感知，但足以合并同一次 composition 的所有事件。
   */
  const commitSearchQuery = React.useCallback((value: string) => {
    clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => setSearchQuery(value), 60)
  }, [])

  const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)
    if (!isComposingRef.current) {
      commitSearchQuery(value)
    }
  }, [commitSearchQuery])

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = React.useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false
    // 不直接读 e.currentTarget.value（在部分浏览器中可能拿到中间态），
    // 而是通过 commitSearchQuery 让微 debounce 等 onChange 也触发后再提交
    commitSearchQuery(e.currentTarget.value)
  }, [commitSearchQuery])

  const handleClearQuery = React.useCallback(() => {
    clearTimeout(commitTimerRef.current)
    setQuery('')
    setSearchQuery('')
  }, [])

  // 标题搜索：即时响应，纯内存过滤，基于 searchQuery 避免输入法抖动
  const titleResults = React.useMemo((): TitleResult[] => {
    if (!searchQuery) return []
    const q = searchQuery.toLowerCase()

    const chatMatches: TitleResult[] = conversations
      .filter((c) => c.title.toLowerCase().includes(q))
      .map((c) => ({ id: c.id, title: c.title, type: 'chat' as const, archived: c.archived, updatedAt: c.updatedAt }))

    const agentMatches: TitleResult[] = agentSessions
      .filter((s) => s.title.toLowerCase().includes(q))
      .map((s) => ({ id: s.id, title: s.title, type: 'agent' as const, archived: s.archived, updatedAt: s.updatedAt }))

    return [...chatMatches, ...agentMatches]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
  }, [searchQuery, conversations, agentSessions])

  // 内容搜索：debounce 300ms 后 IPC 调用，基于 searchQuery
  React.useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setContentResults([])
      setContentLoading(false)
      return
    }

    setContentLoading(true)
    let cancelled = false

    const timer = setTimeout(async () => {
      try {
        const [chatResults, agentResults] = await Promise.all([
          window.electronAPI.searchConversationMessages(searchQuery),
          window.electronAPI.searchAgentSessionMessages(searchQuery),
        ])
        if (cancelled) return

        const titleIds = new Set(titleResults.map((t) => t.id))

        const chatContent: ContentResult[] = (chatResults as MessageSearchResult[])
          .filter((r) => !titleIds.has(r.conversationId))
          .map((r) => ({
            id: r.conversationId,
            title: r.conversationTitle,
            type: 'chat' as const,
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
            snippet: r.snippet,
            matchStart: r.matchStart,
            matchLength: r.matchLength,
            archived: r.archived,
          }))

        setContentResults([...chatContent, ...agentContent])
      } catch (error) {
        console.error('[搜索] 内容搜索失败:', error)
        if (!cancelled) setContentResults([])
      } finally {
        if (!cancelled) setContentLoading(false)
      }
    }, 300)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery, titleResults])

  // 全部结果列表
  const allResults = React.useMemo(
    () => [...titleResults, ...contentResults.map((c) => ({ ...c, updatedAt: 0 }))],
    [titleResults, contentResults]
  )

  // 重置选中索引
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

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

  // 键盘导航
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      e.preventDefault()
      navigateToResult(allResults[selectedIndex]!)
    }
  }, [allResults, selectedIndex, navigateToResult])

  // 自动滚动选中项到可视区域
  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // 全局快捷键 Cmd+F 已迁移到 GlobalShortcuts 组件统一管理

  // 打开时重置状态并聚焦
  React.useEffect(() => {
    if (open) {
      clearTimeout(commitTimerRef.current)
      setQuery('')
      setSearchQuery('')
      setContentResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="sm:max-w-[520px] p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
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
            placeholder="搜索对话和会话..."
            className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-foreground/40 outline-none"
          />
          {query && (
            <button
              onClick={handleClearQuery}
              className="p-0.5 rounded text-foreground/30 hover:text-foreground/60 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-foreground/[0.06] text-[11px] text-foreground/40 font-mono">
            ESC
          </kbd>
        </div>

        {/* 搜索结果 */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto">
          {!query && (
            <div className="py-12 text-center text-[13px] text-foreground/40">
              输入关键词搜索对话标题和消息内容
            </div>
          )}

          {searchQuery && titleResults.length === 0 && contentResults.length === 0 && !contentLoading && (
            <div className="py-12 text-center text-[13px] text-foreground/40">
              未找到匹配结果
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
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors',
                    selectedIndex === idx
                      ? 'bg-primary/10'
                      : 'hover:bg-foreground/[0.04]',
                    result.archived && 'opacity-60'
                  )}
                >
                  {result.type === 'chat' ? (
                    <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
                  ) : (
                    <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
                  )}
                  <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">
                    <HighlightText text={result.title} query={searchQuery} />
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
          {(contentResults.length > 0 || (contentLoading && searchQuery.length >= 2)) && (
            <div className="py-1 border-t border-border/30 animate-in fade-in duration-150">
              <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-[11px] font-medium text-foreground/40 select-none">
                <span>消息内容匹配</span>
                {contentLoading && <Loader2 size={12} className="animate-spin text-foreground/30" />}
              </div>
              {contentResults.map((result, i) => {
                const globalIdx = titleResults.length + i
                return (
                  <button
                    key={`content-${result.id}`}
                    data-index={globalIdx}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={cn(
                      'w-full flex flex-col gap-0.5 px-4 py-2 text-left transition-colors',
                      selectedIndex === globalIdx
                        ? 'bg-primary/10'
                        : 'hover:bg-foreground/[0.04]',
                      result.archived && 'opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {result.type === 'chat' ? (
                        <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
                      ) : (
                        <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
                      )}
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

        {/* 底部快捷键提示 */}
        {allResults.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[11px] text-foreground/30">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↑↓</kbd>
              <span>选择</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↵</kbd>
              <span>打开</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">Esc</kbd>
              <span>关闭</span>
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
