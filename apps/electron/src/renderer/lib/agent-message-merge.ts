import type { SDKMessage } from '@proma/shared'

interface SDKMessageRecord {
  uuid?: unknown
}

function getMessageUuid(message: SDKMessage): string | undefined {
  const uuid = (message as unknown as SDKMessageRecord).uuid
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : undefined
}

/**
 * 合并持久化历史与当前 live 消息。
 *
 * headless/委派 run 启动时，user 消息可能已经写入 JSONL，同时又通过
 * external_run_started 或实时 SDK 事件进入 live 列表。按 UUID 原位更新，
 * 保留消息顺序并避免同一消息在 AgentTranscriptTail 中生成两个 React key。
 * 没有 UUID 的控制消息不做内容推断，继续按原顺序保留。
 */
export function mergePersistedAndLiveAgentMessages(
  persisted: readonly SDKMessage[],
  live: readonly SDKMessage[],
): SDKMessage[] {
  const merged: SDKMessage[] = []
  const indexByUuid = new Map<string, number>()

  const appendOrReplace = (message: SDKMessage): void => {
    const uuid = getMessageUuid(message)
    if (!uuid) {
      merged.push(message)
      return
    }

    const existingIndex = indexByUuid.get(uuid)
    if (existingIndex === undefined) {
      indexByUuid.set(uuid, merged.length)
      merged.push(message)
      return
    }

    const existing = merged[existingIndex]
    merged[existingIndex] = {
      ...(existing as unknown as Record<string, unknown>),
      ...(message as unknown as Record<string, unknown>),
    } as unknown as SDKMessage
  }

  for (const message of persisted) appendOrReplace(message)
  for (const message of live) appendOrReplace(message)
  return merged
}
