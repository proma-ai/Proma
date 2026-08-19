import type { ProviderType } from './channel'
import type { AgentThinkingLevel } from './agent'

/** Proma 可识别的 reasoning 请求协议族。 */
export type ReasoningTransport =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses'
  | 'other'

/**
 * 将渠道归类到其实际的 reasoning 请求协议。
 *
 * 渠道名不能直接决定请求字段；profile 必须同时匹配模型 ID 和 transport，
 * 才能避免把 OpenAI 的 reasoning_effort 发送到 Anthropic endpoint。
 */
export function inferReasoningTransport(provider: ProviderType | undefined): ReasoningTransport {
  switch (provider) {
    case 'openai':
    case 'opencode-go-openai':
    case 'zhipu':
    case 'doubao':
    case 'doubao-api':
    case 'qwen':
    case 'custom':
      return 'openai-completions'
    case 'openai-codex':
    case 'openai-responses':
    case 'xai':
      return 'openai-responses'
    case 'google':
      return 'other'
    default:
      return 'anthropic-messages'
  }
}

/** 编译器据此生成 runtime 专属请求参数。 */
export type ReasoningEncodingKind =
  | 'adaptive-effort'
  | 'deepseek-output-effort'
  | 'openai-reasoning-effort'
  | 'zai-thinking-effort'

/** 每个产品等级映射为目标协议可接受的 effort 值。 */
export type ReasoningEffortMap = Partial<Record<AgentThinkingLevel, string | null>>

export interface ReasoningEncoding {
  kind: ReasoningEncodingKind
  effortMap: ReasoningEffortMap
}

export interface ReasoningProfile {
  id: 'deepseek-v4-flash' | 'deepseek-v4-pro' | 'kimi-k3' | 'glm-5.2' | 'glm-5.3' | 'openai-reasoning-standard' | 'openai-reasoning-max'
  levels: readonly AgentThinkingLevel[]
  defaultLevel: AgentThinkingLevel
  normalize(level: AgentThinkingLevel | undefined): AgentThinkingLevel
  encodings: Partial<Record<ReasoningTransport, ReasoningEncoding>>
}

/** Pi model catalog 中与会话级 reasoning 选择有关的最小元数据。 */
export interface PiCatalogReasoningMetadata {
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<AgentThinkingLevel, string | null>>
}

/**
 * 可跨主进程和渲染进程传输的 reasoning capability。
 *
 * 不携带 protocol encoding；Pi catalog 继续负责把所选 level 编码为实际请求字段。
 */
export interface ReasoningCapability {
  source: 'profile' | 'pi-catalog'
  levels: readonly AgentThinkingLevel[]
  defaultLevel: AgentThinkingLevel
}

export interface ResolveReasoningCapabilityInput {
  profile?: ReasoningProfile
  catalog?: PiCatalogReasoningMetadata
}

export interface ResolveReasoningProfileInput {
  modelId: string | undefined
  transport: ReasoningTransport
}

const DEEPSEEK_V4_LEVELS = ['off', 'low', 'high', 'xhigh', 'max'] as const satisfies readonly AgentThinkingLevel[]
const K3_LEVELS = ['off', 'low', 'high', 'max'] as const satisfies readonly AgentThinkingLevel[]
const GLM_52_LEVELS = ['off', 'high', 'max'] as const satisfies readonly AgentThinkingLevel[]
const GLM_53_LEVELS = ['low', 'high', 'max'] as const satisfies readonly AgentThinkingLevel[]
/**
 * GLM-5.3 强制开启思考，深度由 reasoning_effort / output_config.effort 控制。
 * Coding Plan 会把历史开关输入映射为 low，故不向运行时暴露 off。
 */
const GLM_53_EFFORT_MAP: ReasoningEffortMap = {
  low: 'low',
  high: 'high',
  max: 'max',
}
const OPENAI_STANDARD_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh'] as const satisfies readonly AgentThinkingLevel[]
const OPENAI_MAX_LEVELS = [...OPENAI_STANDARD_LEVELS, 'max'] as const satisfies readonly AgentThinkingLevel[]

// DeepSeek Anthropic compatibility only honors output_config.effort. The official
// V4 Flash and Pro mappings differ at low and xhigh; off is handled by emitting
// `thinking: { type: 'disabled' }` rather than an effort value.
const DEEPSEEK_V4_FLASH_EFFORT_MAP: ReasoningEffortMap = {
  minimal: null,
  low: 'low',
  medium: null,
  high: 'high',
  xhigh: 'high',
  max: 'max',
}
const DEEPSEEK_V4_PRO_EFFORT_MAP: ReasoningEffortMap = {
  minimal: null,
  low: 'high',
  medium: null,
  high: 'high',
  xhigh: 'max',
  max: 'max',
}

const K3_EFFORT_MAP: ReasoningEffortMap = {
  minimal: 'low',
  low: 'low',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
  max: 'max',
}

const GLM_52_OPENAI_EFFORT_MAP: ReasoningEffortMap = {
  minimal: null,
  low: 'high',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
  max: 'max',
}

const GLM_52_ANTHROPIC_EFFORT_MAP: ReasoningEffortMap = {
  minimal: 'high',
  low: 'high',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
  max: 'max',
}

// Pi uses this sparse map as an override for its native level mapping. In particular,
// off must become none because OpenAI reasoning models otherwise default to medium.
const OPENAI_STANDARD_EFFORT_MAP: ReasoningEffortMap = {
  off: 'none',
  minimal: 'low',
  xhigh: 'xhigh',
}
const OPENAI_MAX_EFFORT_MAP: ReasoningEffortMap = {
  ...OPENAI_STANDARD_EFFORT_MAP,
  max: 'max',
}

function normalizeDeepSeekV4Level(level: AgentThinkingLevel | undefined): AgentThinkingLevel {
  switch (level) {
    case 'off':
      return 'off'
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
    case 'high':
      return 'high'
    case 'xhigh':
      return 'xhigh'
    case 'max':
      return 'max'
    default:
      return 'high'
  }
}

function normalizeK3Level(level: AgentThinkingLevel | undefined): AgentThinkingLevel {
  switch (level) {
    case 'off':
      return 'off'
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
    case 'high':
      return 'high'
    case 'xhigh':
    case 'max':
      return 'max'
    default:
      return 'high'
  }
}

function normalizeGlm52Level(level: AgentThinkingLevel | undefined): AgentThinkingLevel {
  if (level === 'off') return 'off'
  return level === 'xhigh' || level === 'max' ? 'max' : 'high'
}

function normalizeGlm53Level(level: AgentThinkingLevel | undefined): AgentThinkingLevel {
  switch (level) {
    case 'minimal':
    case 'low':
    case 'off':
      return 'low'
    case 'medium':
    case 'high':
      return 'high'
    case 'xhigh':
    case 'max':
      return 'max'
    default:
      return 'max'
  }
}

function normalizeOpenAIStandardLevel(level: AgentThinkingLevel | undefined): AgentThinkingLevel {
  if (level === 'off') return 'off'
  if (level === 'minimal') return 'low'
  if (level === 'max') return 'xhigh'
  return level ?? 'high'
}

function normalizeOpenAIMaxLevel(level: AgentThinkingLevel | undefined): AgentThinkingLevel {
  if (level === 'minimal') return 'low'
  return level ?? 'high'
}

const DEEPSEEK_V4_FLASH_PROFILE: ReasoningProfile = {
  id: 'deepseek-v4-flash',
  levels: DEEPSEEK_V4_LEVELS,
  defaultLevel: 'high',
  normalize: normalizeDeepSeekV4Level,
  encodings: {
    'anthropic-messages': { kind: 'deepseek-output-effort', effortMap: DEEPSEEK_V4_FLASH_EFFORT_MAP },
  },
}

const DEEPSEEK_V4_PRO_PROFILE: ReasoningProfile = {
  id: 'deepseek-v4-pro',
  levels: DEEPSEEK_V4_LEVELS,
  defaultLevel: 'high',
  normalize: normalizeDeepSeekV4Level,
  encodings: {
    'anthropic-messages': { kind: 'deepseek-output-effort', effortMap: DEEPSEEK_V4_PRO_EFFORT_MAP },
  },
}

const K3_PROFILE: ReasoningProfile = {
  id: 'kimi-k3',
  levels: K3_LEVELS,
  defaultLevel: 'high',
  normalize: normalizeK3Level,
  encodings: {
    'anthropic-messages': { kind: 'adaptive-effort', effortMap: K3_EFFORT_MAP },
    'openai-completions': { kind: 'openai-reasoning-effort', effortMap: K3_EFFORT_MAP },
  },
}

const GLM_53_PROFILE: ReasoningProfile = {
  id: 'glm-5.3',
  levels: GLM_53_LEVELS,
  defaultLevel: 'max',
  normalize: normalizeGlm53Level,
  encodings: {
    'anthropic-messages': { kind: 'adaptive-effort', effortMap: GLM_53_EFFORT_MAP },
    'openai-completions': { kind: 'zai-thinking-effort', effortMap: GLM_53_EFFORT_MAP },
  },
}

const GLM_52_PROFILE: ReasoningProfile = {
  id: 'glm-5.2',
  levels: GLM_52_LEVELS,
  defaultLevel: 'high',
  normalize: normalizeGlm52Level,
  encodings: {
    'anthropic-messages': { kind: 'adaptive-effort', effortMap: GLM_52_ANTHROPIC_EFFORT_MAP },
    'openai-completions': { kind: 'zai-thinking-effort', effortMap: GLM_52_OPENAI_EFFORT_MAP },
  },
}

const OPENAI_STANDARD_PROFILE: ReasoningProfile = {
  id: 'openai-reasoning-standard',
  levels: OPENAI_STANDARD_LEVELS,
  defaultLevel: 'high',
  normalize: normalizeOpenAIStandardLevel,
  encodings: {
    'openai-completions': { kind: 'openai-reasoning-effort', effortMap: OPENAI_STANDARD_EFFORT_MAP },
    'openai-responses': { kind: 'openai-reasoning-effort', effortMap: OPENAI_STANDARD_EFFORT_MAP },
  },
}

const OPENAI_MAX_PROFILE: ReasoningProfile = {
  id: 'openai-reasoning-max',
  levels: OPENAI_MAX_LEVELS,
  defaultLevel: 'high',
  normalize: normalizeOpenAIMaxLevel,
  encodings: {
    'openai-completions': { kind: 'openai-reasoning-effort', effortMap: OPENAI_MAX_EFFORT_MAP },
    'openai-responses': { kind: 'openai-reasoning-effort', effortMap: OPENAI_MAX_EFFORT_MAP },
  },
}

export const REASONING_PROFILES: readonly ReasoningProfile[] = [
  DEEPSEEK_V4_FLASH_PROFILE,
  DEEPSEEK_V4_PRO_PROFILE,
  K3_PROFILE,
  GLM_52_PROFILE,
  GLM_53_PROFILE,
  OPENAI_STANDARD_PROFILE,
  OPENAI_MAX_PROFILE,
]

/** 仅按模型 ID 匹配，再以实际 transport 确认该模型是否有已验证的协议 encoding。 */
export function resolveReasoningProfile(input: ResolveReasoningProfileInput): ReasoningProfile | undefined {
  const modelId = input.modelId?.toLowerCase()
  if (!modelId) return undefined

  const isOpenAITransport = input.transport === 'openai-completions' || input.transport === 'openai-responses'
  const isOpenAIReasoningModel = !modelId.endsWith('-chat-latest')
    && (modelId.startsWith('gpt-5') || /^(o1|o3|o4)(?:-|$)/.test(modelId))
  const profile = /^deepseek-v4-flash(?:-|$)/.test(modelId)
    ? DEEPSEEK_V4_FLASH_PROFILE
    : /^deepseek-v4-pro(?:-|$)/.test(modelId)
      ? DEEPSEEK_V4_PRO_PROFILE
      : /^(?:k3(?:-256k)?|kimi-k3)$/.test(modelId)
        ? K3_PROFILE
        : modelId === 'glm-5.3'
          ? GLM_53_PROFILE
          : modelId === 'glm-5.2'
            ? GLM_52_PROFILE
            : isOpenAITransport && isOpenAIReasoningModel
              ? /^gpt-5\.6(?:-|$)/.test(modelId) ? OPENAI_MAX_PROFILE : OPENAI_STANDARD_PROFILE
              : undefined

  return profile?.encodings[input.transport] ? profile : undefined
}

const PI_EXTENDED_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly AgentThinkingLevel[]

function getPiCatalogThinkingLevels(catalog: PiCatalogReasoningMetadata): AgentThinkingLevel[] {
  if (!catalog.reasoning) return []

  return PI_EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = catalog.thinkingLevelMap?.[level]
    if (mapped === null) return false
    // Pi only exposes these extended levels when the catalog maps them explicitly.
    return level !== 'xhigh' && level !== 'max' || mapped !== undefined
  })
}

/**
 * 解析最终会话 capability。显式 profile 优先于 Pi catalog，保留经过验证的模型专属编码。
 */
export function resolveReasoningCapability(input: ResolveReasoningCapabilityInput): ReasoningCapability | undefined {
  if (input.profile) {
    return {
      source: 'profile',
      levels: input.profile.levels,
      defaultLevel: input.profile.defaultLevel,
    }
  }

  if (!input.catalog) return undefined
  const levels = getPiCatalogThinkingLevels(input.catalog)
  if (levels.length === 0 || levels.every((level) => level === 'off')) return undefined
  const defaultLevel = normalizeReasoningCapabilityLevel(
    { source: 'pi-catalog', levels, defaultLevel: 'high' },
    'high',
  ) ?? levels[0]!
  return {
    source: 'pi-catalog',
    levels,
    defaultLevel,
  }
}

/**
 * 与 Pi `clampThinkingLevel` 保持一致：请求档位不可用时优先向更高档位靠拢，再向低档位回退。
 */
export function normalizeReasoningCapabilityLevel(
  capability: ReasoningCapability | undefined,
  level: AgentThinkingLevel | undefined,
): AgentThinkingLevel | undefined {
  if (!capability) return level
  const requested = level ?? capability.defaultLevel
  if (capability.levels.includes(requested)) return requested

  const requestedIndex = PI_EXTENDED_THINKING_LEVELS.indexOf(requested)
  if (requestedIndex === -1) return capability.levels[0]
  for (let index = requestedIndex; index < PI_EXTENDED_THINKING_LEVELS.length; index += 1) {
    const candidate = PI_EXTENDED_THINKING_LEVELS[index]
    if (candidate && capability.levels.includes(candidate)) return candidate
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = PI_EXTENDED_THINKING_LEVELS[index]
    if (candidate && capability.levels.includes(candidate)) return candidate
  }
  return capability.levels[0]
}

export function normalizeReasoningLevel(
  profile: ReasoningProfile | undefined,
  level: AgentThinkingLevel | undefined,
): AgentThinkingLevel | undefined {
  return profile ? profile.normalize(level) : level
}
