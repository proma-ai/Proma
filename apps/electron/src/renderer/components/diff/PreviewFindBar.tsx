import * as React from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PreviewFindBarProps {
  open: boolean
  rootRef: React.RefObject<HTMLElement>
  contentKey: string
  unsupportedReason?: string
  onOpenChange: (open: boolean) => void
}

interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

const MATCH_SELECTOR = 'mark[data-proma-find-match]'
const SHADOW_STYLE_ID = 'proma-find-highlight-style'
const CONTROLLED_CONTENT_SELECTOR = [
  '.tiptap[contenteditable="true"]',
  '[data-tiptap-editor][contenteditable="true"]',
  '[data-lexical-editor]',
].join(', ')

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildMatcher(query: string, options: FindOptions): RegExp | null {
  if (!query) return null
  try {
    const source = options.regex ? query : escapeRegExp(query)
    const wrappedSource = options.wholeWord ? `\\b(?:${source})\\b` : source
    return new RegExp(wrappedSource, `g${options.caseSensitive ? '' : 'i'}`)
  } catch {
    return null
  }
}

function discoverShadowRoots(root: ParentNode, target: ShadowRoot[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement
    if (el.shadowRoot) {
      target.push(el.shadowRoot)
      discoverShadowRoots(el.shadowRoot, target)
    }
  }
}

function collectSearchRoots(container: HTMLElement): ParentNode[] {
  const shadowRoots: ShadowRoot[] = []
  discoverShadowRoots(container, shadowRoots)
  return [container, ...shadowRoots]
}

function injectShadowStyle(root: ParentNode): void {
  if (!(root instanceof ShadowRoot)) return
  if (root.getElementById(SHADOW_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = SHADOW_STYLE_ID
  style.textContent = `
    ${MATCH_SELECTOR} {
      background: rgba(250, 204, 21, 0.48);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
    ${MATCH_SELECTOR}[data-proma-find-active="true"] {
      background: rgba(249, 115, 22, 0.72);
      box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.55);
    }
  `
  root.prepend(style)
}

function shouldSkipTextNode(node: Text): boolean {
  if (!node.nodeValue?.trim()) return true
  const parent = node.parentElement
  if (!parent) return true
  if (parent.closest('[data-proma-find-ignore]')) return true
  if (parent.closest(MATCH_SELECTOR)) return true
  if (parent.closest('script, style, input, textarea, select, button')) return true
  if (parent.closest(CONTROLLED_CONTENT_SELECTOR)) return true
  if (parent.closest('[contenteditable="true"]')) return true
  if (parent.closest('.ProseMirror:not([contenteditable="false"])')) return true
  if (parent.closest('[data-gutter], [data-column-number], [data-line-number-content]')) return true
  return false
}

function applyMatchStyle(mark: HTMLElement, active: boolean): void {
  mark.style.background = active ? 'rgba(249, 115, 22, 0.72)' : 'rgba(250, 204, 21, 0.48)'
  mark.style.color = 'inherit'
  mark.style.borderRadius = '2px'
  mark.style.padding = '0 1px'
  mark.style.boxShadow = active ? '0 0 0 1px rgba(249, 115, 22, 0.55)' : 'none'
}

function cleanupHighlights(container: HTMLElement): void {
  for (const root of collectSearchRoots(container)) {
    const marks = Array.from(root.querySelectorAll(MATCH_SELECTOR))
    for (const mark of marks) {
      const parent = mark.parentNode
      if (!parent) continue
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
      parent.normalize()
    }
  }
}

function markMatchesInTextNode(node: Text, matcher: RegExp): HTMLElement[] {
  const text = node.nodeValue ?? ''
  const matches: Array<{ index: number; text: string }> = []
  matcher.lastIndex = 0

  let match = matcher.exec(text)
  while (match) {
    const value = match[0]
    if (value.length === 0) {
      matcher.lastIndex += 1
    } else {
      matches.push({ index: match.index, text: value })
    }
    match = matcher.exec(text)
  }

  if (matches.length === 0) return []

  const fragment = document.createDocumentFragment()
  const marks: HTMLElement[] = []
  let offset = 0
  for (const item of matches) {
    if (item.index > offset) {
      fragment.appendChild(document.createTextNode(text.slice(offset, item.index)))
    }
    const mark = document.createElement('mark')
    mark.dataset.promaFindMatch = 'true'
    mark.textContent = item.text
    applyMatchStyle(mark, false)
    fragment.appendChild(mark)
    marks.push(mark)
    offset = item.index + item.text.length
  }
  if (offset < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(offset)))
  }

  node.parentNode?.replaceChild(fragment, node)
  return marks
}

function applyHighlights(container: HTMLElement, query: string, options: FindOptions): HTMLElement[] {
  cleanupHighlights(container)
  const matcher = buildMatcher(query, options)
  if (!matcher) return []

  const marks: HTMLElement[] = []
  for (const root of collectSearchRoots(container)) {
    injectShadowStyle(root)
    const textNodes: Text[] = []
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      { acceptNode: (node) => shouldSkipTextNode(node as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT },
    )
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text)
    }
    for (const textNode of textNodes) {
      marks.push(...markMatchesInTextNode(textNode, matcher))
    }
  }

  marks.forEach((mark, index) => {
    mark.dataset.promaFindIndex = String(index)
  })
  return marks
}

function setActiveMatch(marks: HTMLElement[], activeIndex: number): void {
  marks.forEach((mark, index) => {
    if (index === activeIndex) {
      mark.dataset.promaFindActive = 'true'
      applyMatchStyle(mark, true)
      mark.scrollIntoView({ block: 'center', inline: 'nearest' })
    } else {
      delete mark.dataset.promaFindActive
      applyMatchStyle(mark, false)
    }
  })
}

export function PreviewFindBar({ open, rootRef, contentKey, unsupportedReason, onOpenChange }: PreviewFindBarProps): React.ReactElement | null {
  const [query, setQuery] = React.useState('')
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [wholeWord, setWholeWord] = React.useState(false)
  const [regex, setRegex] = React.useState(false)
  const [matchCount, setMatchCount] = React.useState(0)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [regexInvalid, setRegexInvalid] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const marksRef = React.useRef<HTMLElement[]>([])
  const activeIndexRef = React.useRef(-1)
  const observerRef = React.useRef<MutationObserver | null>(null)

  /**
   * 在执行 DOM 改动期间临时暂停 MutationObserver，避免自反触发回调。
   * disconnect 期间的 mutation 不会进入 observer 队列，结束后直接 reconnect 即可。
   */
  const withObserverPaused = React.useCallback((fn: () => void) => {
    const obs = observerRef.current
    const root = rootRef.current
    obs?.disconnect()
    try {
      fn()
    } finally {
      if (obs && root) {
        obs.observe(root, { childList: true, subtree: true, characterData: true })
      }
    }
  }, [rootRef])

  const options = React.useMemo<FindOptions>(() => ({
    caseSensitive,
    wholeWord,
    regex,
  }), [caseSensitive, wholeWord, regex])

  const clearMarks = React.useCallback(() => {
    withObserverPaused(() => {
      const root = rootRef.current
      if (root) cleanupHighlights(root)
    })
    marksRef.current = []
    activeIndexRef.current = -1
    setMatchCount(0)
    setActiveIndex(-1)
  }, [rootRef, withObserverPaused])

  const runSearch = React.useCallback(() => {
    const root = rootRef.current
    if (!root || !open || unsupportedReason) return
    const trimmed = query.trim()
    if (!trimmed) {
      clearMarks()
      setRegexInvalid(false)
      return
    }

    const matcher = buildMatcher(trimmed, options)
    setRegexInvalid(options.regex && matcher === null)
    if (!matcher) {
      clearMarks()
      return
    }

    let marks: HTMLElement[] = []
    withObserverPaused(() => {
      marks = applyHighlights(root, trimmed, options)
    })
    const nextActiveIndex = marks.length === 0
      ? -1
      : activeIndexRef.current >= 0
        ? Math.min(activeIndexRef.current, marks.length - 1)
        : 0
    if (nextActiveIndex >= 0) {
      withObserverPaused(() => setActiveMatch(marks, nextActiveIndex))
    }
    marksRef.current = marks
    activeIndexRef.current = nextActiveIndex
    setMatchCount(marks.length)
    setActiveIndex(nextActiveIndex)
  }, [clearMarks, open, options, query, rootRef, unsupportedReason, withObserverPaused])

  React.useEffect(() => {
    if (!open) {
      clearMarks()
      return
    }
    if (unsupportedReason) {
      clearMarks()
      return
    }
    runSearch()
  }, [open, runSearch, clearMarks, contentKey, unsupportedReason])

  React.useEffect(() => {
    if (!open || unsupportedReason) return
    const root = rootRef.current
    if (!root) return

    let timer = 0
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(runSearch, 80)
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    observerRef.current = observer
    return () => {
      observer.disconnect()
      observerRef.current = null
      window.clearTimeout(timer)
    }
  }, [open, rootRef, runSearch, unsupportedReason])

  React.useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  React.useEffect(() => {
    if (activeIndex < 0 || activeIndex >= marksRef.current.length) return
    activeIndexRef.current = activeIndex
    withObserverPaused(() => setActiveMatch(marksRef.current, activeIndex))
  }, [activeIndex, matchCount, withObserverPaused])

  React.useEffect(() => {
    return () => clearMarks()
  }, [clearMarks])

  const goToPrevious = React.useCallback(() => {
    setActiveIndex((prev) => {
      if (matchCount === 0) return -1
      const next = prev <= 0 ? matchCount - 1 : prev - 1
      activeIndexRef.current = next
      return next
    })
  }, [matchCount])

  const goToNext = React.useCallback(() => {
    setActiveIndex((prev) => {
      if (matchCount === 0) return -1
      const next = prev >= matchCount - 1 ? 0 : prev + 1
      activeIndexRef.current = next
      return next
    })
  }, [matchCount])

  const close = React.useCallback(() => {
    onOpenChange(false)
    clearMarks()
  }, [clearMarks, onOpenChange])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goToPrevious()
      else goToNext()
    }
  }, [close, goToNext, goToPrevious])

  if (!open) return null

  const statusText = unsupportedReason
    ? unsupportedReason
    : regexInvalid
    ? '表达式无效'
    : query.trim()
      ? matchCount > 0
        ? `${activeIndex + 1}/${matchCount}`
        : '无结果'
      : ''

  return (
    <div
      data-proma-find-ignore
      role="search"
      aria-label="文件内查找"
      className="absolute right-3 top-2 z-30 flex max-w-[min(390px,calc(100%-24px))] items-center gap-0.5 rounded-lg bg-popover/95 px-1.5 py-1 text-popover-foreground shadow-lg ring-1 ring-border/40 backdrop-blur"
    >
      <Search className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="查找"
        aria-label="查找关键词"
        disabled={Boolean(unsupportedReason)}
        spellCheck={false}
        className="h-5 w-[145px] min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        disabled={Boolean(unsupportedReason)}
        className={cn('h-5 rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground', caseSensitive && 'bg-primary/15 text-primary')}
        title="区分大小写"
        aria-label="区分大小写"
        aria-pressed={caseSensitive}
      >
        Aa
      </button>
      <button
        type="button"
        onClick={() => setWholeWord((v) => !v)}
        disabled={Boolean(unsupportedReason)}
        className={cn('h-5 rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground', wholeWord && 'bg-primary/15 text-primary')}
        title="全词匹配"
        aria-label="全词匹配"
        aria-pressed={wholeWord}
      >
        ab
      </button>
      <button
        type="button"
        onClick={() => setRegex((v) => !v)}
        disabled={Boolean(unsupportedReason)}
        className={cn('h-5 rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground', regex && 'bg-primary/15 text-primary')}
        title="使用正则表达式"
        aria-label="使用正则表达式"
        aria-pressed={regex}
      >
        .*
      </button>
      <span
        role="status"
        aria-live="polite"
        className={cn('min-w-[38px] text-center text-[12px] text-muted-foreground', unsupportedReason && 'min-w-[112px] text-left', regexInvalid && 'text-destructive')}
      >
        {statusText}
      </span>
      <button
        type="button"
        onClick={goToPrevious}
        disabled={Boolean(unsupportedReason) || matchCount === 0}
        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
        title="上一个匹配"
        aria-label="上一个匹配"
      >
        <ChevronUp className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={goToNext}
        disabled={Boolean(unsupportedReason) || matchCount === 0}
        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
        title="下一个匹配"
        aria-label="下一个匹配"
      >
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={close}
        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        title="关闭查找"
        aria-label="关闭查找"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
