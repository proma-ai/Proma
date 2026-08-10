export interface AgentSessionModelSelectionInput {
  hasSessionMeta: boolean
  sessionChannelId?: string
  sessionModelId?: string
  cachedChannelId?: string
  cachedModelId?: string
  defaultChannelId: string | null
  defaultModelId: string | null
}

export interface AgentSessionModelSelection {
  channelId: string | null | undefined
  modelId: string | null | undefined
}

/**
 * 按完整来源解析会话渠道/模型，避免把已有会话的渠道与另一渠道的全局模型拼接。
 * 该函数只读取全局默认，不修改它；会话内切换由调用方单独持久化到 session。
 */
export function resolveAgentSessionModelSelection(
  input: AgentSessionModelSelectionInput,
): AgentSessionModelSelection {
  if (input.hasSessionMeta && input.sessionChannelId) {
    const cachedModelId = input.cachedChannelId === input.sessionChannelId
      ? input.cachedModelId
      : undefined
    return {
      channelId: input.sessionChannelId,
      modelId: input.sessionModelId ?? cachedModelId,
    }
  }

  if (input.cachedChannelId) {
    return {
      channelId: input.cachedChannelId,
      modelId: input.cachedModelId,
    }
  }

  return {
    channelId: input.defaultChannelId,
    modelId: input.defaultModelId,
  }
}
