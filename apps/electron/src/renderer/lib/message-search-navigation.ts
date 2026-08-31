import { findBestSearchMatch } from '@proma/shared'

/** 页面上一条可定位的消息组锚点。 */
export interface MessageSearchAnchor {
  /** 页面实际渲染在 data-message-id 上的 ID。 */
  anchorId: string
  /** 该消息组包含的持久化消息 ID。 */
  messageIds: string[]
}

export interface MessageSearchNavigationRequest {
  sessionType: 'chat' | 'agent'
  sessionId: string
  messageId: string
  query: string
  snippet: string
  matchStart: number
  matchLength: number
}

export interface MessageSearchResultNavigationInput {
  type: 'chat' | 'agent'
  id: string
  messageId: string
  title: string
  snippet: string
  matchStart: number
  matchLength: number
  updatedAt: number
}

export interface TextMatchRange {
  matchStart: number
  matchLength: number
}

export interface MessageSearchNavigationState {
  pendingNavigation: MessageSearchNavigationRequest | null
  activeHighlight: MessageSearchNavigationRequest | null
}

export type MessageSearchNavigationAttempt = 'applied' | 'pending' | 'failed'

export interface AttemptMessageSearchNavigationInput<TTarget> {
  navigation: MessageSearchNavigationRequest
  findTarget: (messageId: string) => TTarget | null
  canRetry: boolean
  retry?: () => void
  scrollToTarget: (target: TTarget) => void
  highlightTarget: (target: TTarget, navigation: MessageSearchNavigationRequest) => boolean
}

export type MessageSearchNavigationAction =
  | { type: 'request'; navigation: MessageSearchNavigationRequest }
  | { type: 'activate'; navigation: MessageSearchNavigationRequest }
  | { type: 'clear' }
  | { type: 'leave-session'; sessionType: 'chat' | 'agent'; sessionId: string }

interface TextPosition {
  node: Node
  offset: number
}

interface CustomHighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => boolean
}

type HighlightConstructor = new (...ranges: Range[]) => unknown

export const MESSAGE_SEARCH_HIGHLIGHT_NAME = 'proma-message-search'

export function createMessageSearchNavigation(
  result: MessageSearchResultNavigationInput,
  query: string,
): MessageSearchNavigationRequest {
  return {
    sessionType: result.type,
    sessionId: result.id,
    messageId: result.messageId,
    query,
    snippet: result.snippet,
    matchStart: result.matchStart,
    matchLength: result.matchLength,
  }
}

export function createMessageSearchNavigationState(): MessageSearchNavigationState {
  return { pendingNavigation: null, activeHighlight: null }
}

export function reduceMessageSearchNavigationState(
  state: MessageSearchNavigationState,
  action: MessageSearchNavigationAction,
): MessageSearchNavigationState {
  if (action.type === 'request') return { pendingNavigation: action.navigation, activeHighlight: null }
  if (action.type === 'activate') return { pendingNavigation: null, activeHighlight: action.navigation }
  if (action.type === 'clear') return createMessageSearchNavigationState()

  const ownsNavigation = (navigation: MessageSearchNavigationRequest | null): boolean => (
    navigation?.sessionType === action.sessionType && navigation.sessionId === action.sessionId
  )
  const pendingNavigation = ownsNavigation(state.pendingNavigation) ? null : state.pendingNavigation
  const activeHighlight = ownsNavigation(state.activeHighlight) ? null : state.activeHighlight
  return { pendingNavigation, activeHighlight }
}

export function shouldClearMessageSearchHighlightOnSessionLeave(
  state: MessageSearchNavigationState,
  sessionType: 'chat' | 'agent',
  sessionId: string,
): boolean {
  const ownsNavigation = (navigation: MessageSearchNavigationRequest | null): boolean => (
    navigation?.sessionType === sessionType && navigation.sessionId === sessionId
  )
  return ownsNavigation(state.pendingNavigation) || ownsNavigation(state.activeHighlight)
}

/**
 * 利用搜索结果携带的上下文，在合并渲染的助手 turn 中找到准确的那次命中。
 * 完整 snippet 因 Markdown 标记变化无法直接匹配时，使用左右上下文为同词候选打分。
 */
export function resolveMessageSearchTextRange(
  renderedText: string,
  navigation: Pick<MessageSearchNavigationRequest, 'query' | 'snippet' | 'matchStart' | 'matchLength'>,
): TextMatchRange | null {
  const { snippet, matchStart, matchLength, query } = navigation
  if (matchStart < 0 || matchLength <= 0 || matchStart + matchLength > snippet.length) {
    return findBestSearchMatch(renderedText, query)
  }

  const leadingEllipsisLength = snippet.startsWith('...') ? 3 : 0
  const trailingEllipsisLength = snippet.endsWith('...') ? 3 : 0
  const snippetBodyEnd = snippet.length - trailingEllipsisLength
  const snippetBody = snippet.slice(leadingEllipsisLength, snippetBodyEnd)
  const bodyMatchStart = matchStart - leadingEllipsisLength
  if (bodyMatchStart >= 0 && bodyMatchStart + matchLength <= snippetBody.length) {
    const bodyIndex = renderedText.indexOf(snippetBody)
    if (bodyIndex >= 0) return { matchStart: bodyIndex + bodyMatchStart, matchLength }
  }

  const matchedText = snippet.slice(matchStart, matchStart + matchLength)
  if (!matchedText) return findBestSearchMatch(renderedText, query)

  const leftContext = snippet.slice(leadingEllipsisLength, matchStart)
  const rightContext = snippet.slice(matchStart + matchLength, snippetBodyEnd)
  const lowerText = renderedText.toLocaleLowerCase()
  const lowerMatch = matchedText.toLocaleLowerCase()
  let best: { range: TextMatchRange; score: number } | null = null
  let candidateStart = lowerText.indexOf(lowerMatch)
  while (candidateStart >= 0) {
    const before = renderedText.slice(0, candidateStart)
    const after = renderedText.slice(candidateStart + matchedText.length)
    let leftScore = 0
    while (
      leftScore < leftContext.length
      && leftScore < before.length
      && leftContext[leftContext.length - 1 - leftScore] === before[before.length - 1 - leftScore]
    ) leftScore++
    let rightScore = 0
    while (
      rightScore < rightContext.length
      && rightScore < after.length
      && rightContext[rightScore] === after[rightScore]
    ) rightScore++
    const score = leftScore + rightScore
    if (!best || score > best.score) {
      best = { range: { matchStart: candidateStart, matchLength: matchedText.length }, score }
    }
    candidateStart = lowerText.indexOf(lowerMatch, candidateStart + Math.max(1, lowerMatch.length))
  }

  return best?.range ?? findBestSearchMatch(renderedText, query)
}

/**
 * 将搜索服务返回的持久化消息 ID 映射到页面实际渲染的消息组锚点。
 * 一次助手回复可能由多条消息快照组成，但页面只为整组渲染一个锚点。
 */
export function resolveMessageSearchAnchorId(
  anchors: MessageSearchAnchor[],
  messageId: string,
): string | null {
  return anchors.find((anchor) => anchor.messageIds.includes(messageId))?.anchorId ?? null
}

/** 执行一次消息定位；历史尚未加载完整时保留请求并触发下一页。 */
export function attemptMessageSearchNavigation<TTarget>(
  input: AttemptMessageSearchNavigationInput<TTarget>,
): MessageSearchNavigationAttempt {
  const target = input.findTarget(input.navigation.messageId)
  if (!target) {
    if (!input.canRetry) return 'failed'
    input.retry?.()
    return 'pending'
  }

  input.scrollToTarget(target)
  return input.highlightTarget(target, input.navigation) ? 'applied' : 'failed'
}

function getCustomHighlightRegistry(): CustomHighlightRegistry | undefined {
  return (globalThis.CSS as unknown as { highlights?: CustomHighlightRegistry }).highlights
}

function getMessageTextPosition(messageElement: HTMLElement, offset: number): TextPosition | null {
  if (!Number.isInteger(offset) || offset < 0) return null
  const walker = document.createTreeWalker(messageElement, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let lastTextNode: Node | null = null
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (offset <= consumed + length) return { node, offset: offset - consumed }
    consumed += length
    lastTextNode = node
    node = walker.nextNode()
  }
  if (offset === consumed && lastTextNode) {
    return { node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0 }
  }
  return null
}

export function clearMessageSearchHighlight(): void {
  getCustomHighlightRegistry()?.delete(MESSAGE_SEARCH_HIGHLIGHT_NAME)
}

export function applyMessageSearchHighlight(
  messageElement: HTMLElement,
  navigation: MessageSearchNavigationRequest,
): boolean {
  const match = resolveMessageSearchTextRange(messageElement.textContent ?? '', navigation)
  if (!match) return false
  const start = getMessageTextPosition(messageElement, match.matchStart)
  const end = getMessageTextPosition(messageElement, match.matchStart + match.matchLength)
  if (!start || !end) return false

  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  const registry = getCustomHighlightRegistry()
  const Highlight = (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight
  if (!registry || !Highlight) return false
  registry.set(MESSAGE_SEARCH_HIGHLIGHT_NAME, new Highlight(range))
  return true
}
