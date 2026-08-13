import { getSDKCompactStatus, type SDKMessage, type SDKSystemMessage } from '@proma/shared'
import type { MessageGroup } from './SDKMessageRenderer'

interface BuildLiveGroupSetOptions {
  allGroups: MessageGroup[]
  liveMessages?: readonly SDKMessage[] | null
  streaming: boolean
  /** 当前运行的起始时间，用于从跨队列残留的实时消息中识别本轮。 */
  activeRunStartedAt?: number
}

type RunScopedLiveMessage = SDKMessage & {
  _promaLiveRunStartedAt?: number
}

const EMPTY_LIVE_GROUPS: ReadonlySet<MessageGroup> = new Set<MessageGroup>()

/**
 * 只有会话仍在流式输出时，liveMessages 才代表“运行中的消息”。
 * 流式结束后它只是防闪烁桥接数据，不应继续触发展开态、隐藏操作栏等 live UI。
 */
export function buildLiveGroupSet({
  allGroups,
  liveMessages,
  streaming,
  activeRunStartedAt,
}: BuildLiveGroupSetOptions): ReadonlySet<MessageGroup> {
  if (!streaming || !liveMessages || liveMessages.length === 0) return EMPTY_LIVE_GROUPS

  // 自动派发下一条队列消息时，上一轮的实时消息会保留到落盘刷新完成。
  // 新旧 run 之间若没有可见的 `streaming=false` 渲染，旧过程组将一直维持展开态。
  // 以运行起始时间限定 live 集合，令上一轮立即进入完成态并执行自动折叠。
  const activeLiveMessages = activeRunStartedAt == null
    ? liveMessages
    : liveMessages.filter((message) => (
      (message as RunScopedLiveMessage)._promaLiveRunStartedAt === activeRunStartedAt
    ))
  // 自主压缩会在同一 stream 内插入 system 压缩状态，并在完成后继续输出。
  // 这时压缩前的 assistant 消息仍属于当前运行的 liveMessages；若仍标为 live，
  // 它的 ProcessBlockGroup 会一直保持展开。以最近压缩状态为边界，仅让
  // 压缩后新产生的消息驱动 live UI，前一段随即进入完成态并自动折叠。
  const latestCompactionIndex = activeLiveMessages.findLastIndex((message) => (
    message.type === 'system'
      && getSDKCompactStatus(message as SDKSystemMessage) != null
  ))
  const currentSegmentMessages = latestCompactionIndex >= 0
    ? activeLiveMessages.slice(latestCompactionIndex + 1)
    : activeLiveMessages
  const liveSet = new Set<SDKMessage>(currentSegmentMessages)
  const result = new Set<MessageGroup>()

  for (const group of allGroups) {
    if (group.type === 'user' || group.type === 'system') {
      if (liveSet.has(group.message as SDKMessage)) {
        result.add(group)
      }
      continue
    }

    // assistant-turn 可能被 mergeAdjacentSameModelTurns 合并，
    // 需检查任意一条 assistantMessage 是否来自实时流。
    if (group.assistantMessages.some((message) => liveSet.has(message as SDKMessage))) {
      result.add(group)
    }
  }

  return result
}
