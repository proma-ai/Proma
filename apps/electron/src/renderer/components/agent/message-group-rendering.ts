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
