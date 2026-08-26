import { normalizeReasoningCapabilityLevel, resolveChannelReasoningCapability } from '@proma/shared'
import type { AgentThinkingLevel, ChannelModelReasoningConfig, ReasoningCapability } from '@proma/shared'

export const CHANNEL_REASONING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly AgentThinkingLevel[]

/** 生成推理能力缓存键，任一维度变化即触发重新解析。 */
export function createReasoningCapabilityKey(input: {
  channelId: string | null
  modelId: string | null
  channelUpdatedAt?: number
  reasoning?: ChannelModelReasoningConfig
}): string {
  return [
    input.channelId ?? '',
    input.modelId ?? '',
    input.channelUpdatedAt ?? '',
    JSON.stringify(input.reasoning ?? null),
  ].join(':')
}

/** 三级优先级解析会话推理能力：内置 profile > 频道声明 > IPC 远端目录。 */
export function resolveConversationReasoningCapability(input: {
  profile?: ReasoningCapability
  channelReasoning?: ChannelModelReasoningConfig
  remote?: ReasoningCapability
}): ReasoningCapability | undefined {
  return input.profile
    ?? resolveChannelReasoningCapability(input.channelReasoning)
    ?? input.remote
}

/** 创建空白推理配置：不预置档位，默认档位 high。 */
export function createChannelReasoningConfig(): ChannelModelReasoningConfig {
  return {
    levels: [],
    defaultLevel: 'high',
    thinkingLevelMap: {},
  }
}

/** 添加推理档位，首个档位自动设为默认。 */
export function addChannelReasoningLevel(
  config: ChannelModelReasoningConfig,
  level: AgentThinkingLevel,
): ChannelModelReasoningConfig {
  if (config.levels.includes(level)) return config
  return {
    ...config,
    levels: [...config.levels, level],
    defaultLevel: config.levels.length === 0 ? level : config.defaultLevel,
  }
}

/** 删除推理档位，若删除的是默认档位则回退到剩余首档。 */
export function removeChannelReasoningLevel(
  config: ChannelModelReasoningConfig,
  level: AgentThinkingLevel,
): ChannelModelReasoningConfig {
  const levels = config.levels.filter((item) => item !== level)
  const thinkingLevelMap = { ...config.thinkingLevelMap }
  delete thinkingLevelMap[level]
  return {
    ...config,
    levels,
    defaultLevel: config.defaultLevel === level ? (levels[0] ?? 'high') : config.defaultLevel,
    thinkingLevelMap,
  }
}

/** 设置或清除某档位的线上 effort 映射，空字符串表示删除映射。 */
export function updateChannelReasoningEffort(
  config: ChannelModelReasoningConfig,
  level: AgentThinkingLevel,
  effort: string,
): ChannelModelReasoningConfig {
  const thinkingLevelMap = { ...config.thinkingLevelMap }
  const normalizedEffort = effort.trim()
  if (normalizedEffort) {
    thinkingLevelMap[level] = normalizedEffort
  } else {
    delete thinkingLevelMap[level]
  }
  return { ...config, thinkingLevelMap }
}

/** 解析 Chat 发送时的请求档位：思考开启时用会话档位或默认档位，关闭时仅发送 off。 */
export function resolveConversationRequestReasoningLevel(input: {
  config?: ChannelModelReasoningConfig
  selectedLevel?: AgentThinkingLevel
  enabled: boolean
}): AgentThinkingLevel | undefined {
  const capability = resolveChannelReasoningCapability(input.config)
  if (!capability) return undefined
  if (!input.enabled) return capability.levels.includes('off') ? 'off' : undefined
  return normalizeReasoningCapabilityLevel(
    capability,
    input.selectedLevel ?? capability.defaultLevel,
  )
}