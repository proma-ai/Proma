import type { AgentThinkingLevel } from '../types/agent'

export type GeminiThinkingLevel = Extract<AgentThinkingLevel, 'minimal' | 'low' | 'medium' | 'high'>

export interface GeminiModelCapability {
  contextWindow: number
  maxOutputTokens: number
  thinkingLevels: readonly GeminiThinkingLevel[]
  defaultThinkingLevel: GeminiThinkingLevel
}

const ONE_MILLION = 1_000_000
const SIXTY_FOUR_K = 65_536

const ALL_LEVELS = ['minimal', 'low', 'medium', 'high'] as const satisfies readonly GeminiThinkingLevel[]
const NO_MINIMAL_LEVELS = ['low', 'medium', 'high'] as const satisfies readonly GeminiThinkingLevel[]

/**
 * Gemini 文本模型的产品级能力表。
 *
 * Pi catalog 负责 Agent runtime 的协议与计费元数据；这里仅保存 Proma 必须跨
 * Agent、Chat 和上下文展示共用的官方模型约束，避免把 Image / Live SKU 误判为 1M。
 */
const GEMINI_TEXT_MODEL_CAPABILITIES: Readonly<Record<string, GeminiModelCapability>> = {
  'gemini-3-flash-preview': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: ALL_LEVELS,
    defaultThinkingLevel: 'high',
  },
  'gemini-3.1-pro': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: NO_MINIMAL_LEVELS,
    defaultThinkingLevel: 'high',
  },
  'gemini-3.1-pro-preview': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: NO_MINIMAL_LEVELS,
    defaultThinkingLevel: 'high',
  },
  // Google catalog 在启用 custom tools 时使用此精确别名；它仍是同一文本模型，
  // 不能误回退到旧版 thinkingBudget 或默认 200K 上下文。
  'gemini-3.1-pro-preview-customtools': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: NO_MINIMAL_LEVELS,
    defaultThinkingLevel: 'high',
  },
  'gemini-3.1-flash-lite': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: ALL_LEVELS,
    defaultThinkingLevel: 'minimal',
  },
  'gemini-3.1-flash-lite-preview': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: ALL_LEVELS,
    defaultThinkingLevel: 'minimal',
  },
  'gemini-3.5-flash': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: ALL_LEVELS,
    defaultThinkingLevel: 'medium',
  },
  'gemini-3.5-flash-lite': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: ALL_LEVELS,
    defaultThinkingLevel: 'minimal',
  },
  'gemini-3.6-flash': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: ALL_LEVELS,
    defaultThinkingLevel: 'medium',
  },
  'gemini-3.7-flash': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: NO_MINIMAL_LEVELS,
    defaultThinkingLevel: 'medium',
  },
  'gemini-3.8-flash': {
    contextWindow: ONE_MILLION,
    maxOutputTokens: SIXTY_FOUR_K,
    thinkingLevels: NO_MINIMAL_LEVELS,
    defaultThinkingLevel: 'medium',
  },
}

function normalizeGeminiModelId(modelId: string | undefined): string | undefined {
  return modelId?.trim().toLowerCase().replace(/^models\//, '')
}

export function getGeminiModelCapability(modelId: string | undefined): GeminiModelCapability | undefined {
  const normalized = normalizeGeminiModelId(modelId)
  return normalized ? GEMINI_TEXT_MODEL_CAPABILITIES[normalized] : undefined
}

export function normalizeGeminiThinkingLevel(
  modelId: string | undefined,
  level: GeminiThinkingLevel | undefined,
): GeminiThinkingLevel | undefined {
  const capability = getGeminiModelCapability(modelId)
  if (!capability) return level
  return level && capability.thinkingLevels.includes(level) ? level : capability.defaultThinkingLevel
}
