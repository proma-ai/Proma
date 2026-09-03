import type { AgentSessionMeta, FeishuChatBinding } from '@proma/shared'

interface FeishuBindingRouteFallback {
  channelId?: string
  modelId?: string
}

/**
 * 恢复飞书聊天绑定时，已持久化的 per-chat 路由优先。
 *
 * Bot 或应用默认值只用于补齐旧绑定缺失的字段，不能覆盖用户通过
 * `/model` 为某个聊天显式选择并已经写盘的渠道和模型。
 */
export function restorePersistedFeishuBinding(
  binding: FeishuChatBinding,
  session: Pick<AgentSessionMeta, 'archived' | 'updatedAt'>,
  fallback: FeishuBindingRouteFallback,
): FeishuChatBinding {
  const restored = { ...binding }

  if (restored.source === 'session-mirror' && session.archived) {
    restored.archived = true
    restored.archivedAt ??= session.updatedAt
  }

  if (!restored.channelId && fallback.channelId) {
    restored.channelId = fallback.channelId
  }
  if (!restored.modelId && fallback.modelId) {
    restored.modelId = fallback.modelId
  }

  return restored
}
