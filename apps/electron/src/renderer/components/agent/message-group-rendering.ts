import type { SDKMessage, SDKUserMessage } from '@proma/shared'
import { groupIntoTurns, isUserInputMessage, type MessageGroup } from '@proma/session-core'

export interface MessageGroupRenderCache {
  prefixLength: number
  prefixMessages: SDKMessage[]
  sessionModelId?: string
  prefixGroups: MessageGroup[]
  previousGroups: MessageGroup[]
}

export function createMessageGroupRenderCache(): MessageGroupRenderCache {
  return {
    prefixLength: 0,
    prefixMessages: [],
    prefixGroups: [],
    previousGroups: [],
  }
}

function arraysShareItems<T>(previous: T[], next: T[]): boolean {
  if (previous.length !== next.length) return false
  return previous.every((item, index) => item === next[index])
}

function canReuseMessageGroup(previous: MessageGroup, next: MessageGroup): boolean {
  if (previous.type !== next.type) return false

  if (previous.type === 'user' && next.type === 'user') {
    return previous.message === next.message
  }
  if (previous.type === 'system' && next.type === 'system') {
    return previous.message === next.message && previous.identityMessage === next.identityMessage
  }
  if (previous.type !== 'assistant-turn' || next.type !== 'assistant-turn') return false

  return previous.inputMessage === next.inputMessage
    && previous.model === next.model
    && previous.createdAt === next.createdAt
    && previous.startsAfterWake === next.startsAfterWake
    && arraysShareItems(previous.assistantMessages, next.assistantMessages)
    && arraysShareItems(previous.turnMessages, next.turnMessages)
}

/**
 * groupIntoTurns 每次都会创建新的 group/数组。复用内容未变的历史 group 引用，
 * 让 React.memo 可以跳过已完成回合的 Markdown、代码高亮和工具结果渲染。
 */
export function stabilizeMessageGroups(previous: MessageGroup[], next: MessageGroup[]): MessageGroup[] {
  let changed = previous.length !== next.length
  const stable = next.map((group, index) => {
    const prior = previous[index]
    if (prior && canReuseMessageGroup(prior, group)) return prior
    changed = true
    return group
  })
  return changed ? stable : previous
}

function longestSuffixToPrefixOverlap(text: string[], pattern: string[]): number {
  if (text.length === 0 || pattern.length === 0) return 0

  const prefixTable = new Array<number>(pattern.length).fill(0)
  for (let index = 1, matched = 0; index < pattern.length; index += 1) {
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = prefixTable[matched - 1]!
    }
    if (pattern[index] === pattern[matched]) matched += 1
    prefixTable[index] = matched
  }

  let matched = 0
  for (const value of text) {
    if (matched === pattern.length) matched = prefixTable[matched - 1]!
    while (matched > 0 && value !== pattern[matched]) {
      matched = prefixTable[matched - 1]!
    }
    if (value === pattern[matched]) matched += 1
  }
  return matched
}

function longestCommonSuffix(left: string[], right: string[]): number {
  let overlap = 0
  while (
    overlap < left.length
    && overlap < right.length
    && left[left.length - overlap - 1] === right[right.length - overlap - 1]
  ) {
    overlap += 1
  }
  return overlap
}

export function mergeOverlappingMessageSnapshots(
  persisted: SDKMessage[],
  live: SDKMessage[],
  getStableKey: (message: SDKMessage) => string,
): SDKMessage[] {
  if (persisted.length === 0) return live
  if (live.length === 0) return persisted

  // 将 key 计算限制为每条消息一次；重叠匹配使用线性算法，避免在 live 热路径上反复嵌套扫描。
  const persistedKeys = persisted.map(getStableKey)
  const liveKeys = live.map(getStableKey)
  const prefixOverlap = longestSuffixToPrefixOverlap(persistedKeys, liveKeys)
  const suffixOverlap = longestCommonSuffix(persistedKeys, liveKeys)
  const overlap = Math.max(prefixOverlap, suffixOverlap)

  if (overlap === 0) return [...persisted, ...live]
  const liveOverlapStart = prefixOverlap >= suffixOverlap ? 0 : live.length - suffixOverlap
  return [
    ...persisted.slice(0, persisted.length - overlap),
    ...live.slice(liveOverlapStart),
  ]
}

function findActiveTurnBoundary(messages: SDKMessage[]): number {
  return messages.findLastIndex((message) => (
    message.type === 'user' && isUserInputMessage(message as SDKUserMessage)
  ))
}

/**
 * 流式时只重新分组当前 turn，历史前缀按 O(1) 身份检查复用。
 * 边界从最后一条真实用户输入开始，因此与完整 groupIntoTurns 的分组语义一致。
 */
export function groupMessagesForRendering(
  messages: SDKMessage[],
  sessionModelId: string | undefined,
  streaming: boolean,
  cache: MessageGroupRenderCache,
): { groups: MessageGroup[]; cache: MessageGroupRenderCache } {
  if (!streaming) {
    const groups = stabilizeMessageGroups(cache.previousGroups, groupIntoTurns(messages, sessionModelId))
    return {
      groups,
      cache: {
        prefixLength: 0,
        prefixMessages: [],
        prefixGroups: [],
        previousGroups: groups,
        sessionModelId,
      },
    }
  }

  const boundary = findActiveTurnBoundary(messages)
  if (boundary <= 0) {
    const groups = stabilizeMessageGroups(cache.previousGroups, groupIntoTurns(messages, sessionModelId))
    return {
      groups,
      cache: {
        prefixLength: 0,
        prefixMessages: [],
        prefixGroups: [],
        previousGroups: groups,
        sessionModelId,
      },
    }
  }

  const canReusePrefix = cache.prefixLength === boundary
    && cache.sessionModelId === sessionModelId
    && cache.prefixMessages.every((message, index) => messages[index] === message)
  const prefixMessages = canReusePrefix ? cache.prefixMessages : messages.slice(0, boundary)
  const prefixGroups = canReusePrefix
    ? cache.prefixGroups
    : groupIntoTurns(prefixMessages, sessionModelId)
  const activeGroups = groupIntoTurns(messages.slice(boundary), sessionModelId)
  const groups = stabilizeMessageGroups(cache.previousGroups, [...prefixGroups, ...activeGroups])

  return {
    groups,
    cache: {
      prefixLength: boundary,
      prefixMessages,
      sessionModelId,
      prefixGroups,
      previousGroups: groups,
    },
  }
}
