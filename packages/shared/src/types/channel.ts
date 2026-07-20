/**
 * 渠道（Channel）相关类型定义
 *
 * 渠道是用户配置的 AI 供应商连接，包含 API Key、模型列表等信息。
 * API Key 使用 Electron safeStorage 加密后存储在本地配置文件中。
 */

/**
 * 支持的 AI 供应商类型
 */
export type ProviderType =
  | 'anthropic'
  | 'anthropic-compatible'
  | 'openai'
  | 'openai-responses'
  | 'deepseek'
  | 'google'
  | 'kimi-api'
  | 'kimi-coding'
  | 'zhipu'
  | 'zhipu-coding'
  | 'zhipu-coding-team'
  | 'ark-coding-plan'
  | 'minimax'
  | 'doubao'
  | 'qwen'
  | 'qwen-anthropic'
  | 'xiaomi'
  | 'xiaomi-token-plan'
  | 'openai-codex'
  /**
   * OpenAI Chat Completions 的自定义请求地址。
   *
   * Chat 会原样请求 `baseUrl`；`openai` 则将其视为协议根地址并自动补
   * `/chat/completions`。这保留了接入自定义网关的能力。
   */
  | 'custom'

/**
 * 各供应商的默认 Base URL
 */
export const PROVIDER_DEFAULT_URLS: Record<ProviderType, string> = {
  anthropic: 'https://api.anthropic.com',
  'anthropic-compatible': '',
  openai: 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/anthropic',
  google: 'https://generativelanguage.googleapis.com',
  'kimi-api': 'https://api.moonshot.cn/anthropic',
  'kimi-coding': 'https://api.kimi.com/coding/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  'zhipu-coding': 'https://open.bigmodel.cn/api/anthropic',
  'zhipu-coding-team': 'https://open.bigmodel.cn/api/anthropic',
  'ark-coding-plan': 'https://ark.cn-beijing.volces.com/api/plan',
  minimax: 'https://api.minimaxi.com/anthropic',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'qwen-anthropic': 'https://dashscope.aliyuncs.com/apps/anthropic',
  xiaomi: 'https://api.xiaomimimo.com/anthropic',
  'xiaomi-token-plan': 'https://token-plan-cn.xiaomimimo.com/anthropic',
  // ChatGPT 订阅登录：baseUrl 由 Pi SDK 内部管理（登录后从 OAuth token 派生），无需用户填写。
  'openai-codex': '',
  custom: '',
}

/**
 * 供应商显示名称
 */
export const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic',
  'anthropic-compatible': 'Anthropic 兼容格式',
  openai: 'OpenAI',
  'openai-responses': 'OpenAI Responses 格式',
  deepseek: 'DeepSeek',
  google: 'Google',
  'kimi-api': 'Kimi API (Anthropic 协议)',
  'kimi-coding': 'Kimi Coding Plan',
  zhipu: '智谱 AI',
  'zhipu-coding': '智谱 Coding Plan',
  'zhipu-coding-team': '智谱 Coding Plan 团队版',
  'ark-coding-plan': '火山方舟 Coding Plan',
  minimax: 'MiniMax (API&编程包)',
  doubao: '豆包',
  qwen: '通义千问',
  'qwen-anthropic': '通义千问 (Anthropic 协议)',
  xiaomi: '小米 MiMo (API)',
  'xiaomi-token-plan': '小米 MiMo Token Plan',
  'openai-codex': 'ChatGPT 订阅 (Codex)',
  custom: 'OpenAI Chat Completions（自定义地址）',
}

/**
 * 支持 Claude Agent Core 的供应商类型
 *
 * Claude Agent SDK 通过 Anthropic 兼容协议调用 `/v1/messages` 端点，
 * 因此所有 Anthropic 协议兼容的供应商都可以用于 Agent。
 */
export const AGENT_COMPATIBLE_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'anthropic',
  'anthropic-compatible',
  'deepseek',
  'kimi-api',
  'kimi-coding',
  'zhipu-coding',
  'zhipu-coding-team',
  'ark-coding-plan',
  'minimax',
  'xiaomi',
  'xiaomi-token-plan',
  'qwen-anthropic',
])

/**
 * 判断供应商是否兼容 Claude Agent Core
 */
export function isAgentCompatibleProvider(provider: ProviderType): boolean {
  return AGENT_COMPATIBLE_PROVIDERS.has(provider)
}

export interface ZhipuTeamCredentials {
  apiKey: string
  organization?: string
  project?: string
}

function normalizeZhipuCredentialKey(key: string): string {
  return key.trim().toLowerCase().replace(/[_-]/g, '')
}

export function parseZhipuTeamCredentials(secret: string): ZhipuTeamCredentials | null {
  const trimmed = secret.trim()
  if (!trimmed) return null

  const pick = (record: Record<string, unknown>): ZhipuTeamCredentials | null => {
    const normalized = new Map<string, string>()
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' && value.trim()) {
        normalized.set(normalizeZhipuCredentialKey(key), value.trim())
      }
    }
    const apiKey = normalized.get('apikey')
      ?? normalized.get('apitoken')
      ?? normalized.get('token')
      ?? normalized.get('authorization')
      ?? normalized.get('auth')
      ?? normalized.get('bearer')
    const organization = normalized.get('bigmodelorganization') ?? normalized.get('organization') ?? normalized.get('org')
    const project = normalized.get('bigmodelproject') ?? normalized.get('project')
    if (!apiKey) return null
    return { apiKey, organization, project }
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return pick(parsed as Record<string, unknown>)
      }
    } catch {
      return null
    }
  }

  const entries: Record<string, string> = {}
  for (const part of trimmed.split(/[;\n]+/)) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    entries[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }
  return pick(entries)
}

export function extractZhipuCodingTeamApiToken(secret: string): string {
  const credentials = parseZhipuTeamCredentials(secret)
  if (credentials) return credentials.apiKey
  const trimmed = secret.trim()
  return trimmed || secret
}

/**
 * ChatGPT (OpenAI Codex) OAuth 凭据。
 *
 * 复用 Channel.apiKey 字段承载：序列化为 JSON 后经 safeStorage 加密存储，
 * 与 zhipu-coding-team 的结构化 secret 同一套「凭据塞进 apiKey 字段」模式，
 * 避免为 OAuth 单独扩展存储 schema。字段命名对齐 Pi SDK 的 OAuthCredentials
 * （access/refresh/expires），expires 为 Unix 毫秒时间戳。
 */
export interface CodexOAuthCredentials {
  /** access token（作为 bearer token 传给 Pi SDK provider） */
  access: string
  /** refresh token（过期时用于换取新 token） */
  refresh: string
  /** access token 过期时间戳（Unix 毫秒） */
  expires: number
  /** 可选：从 id_token 解析出的账号标识，用于展示登录身份 */
  accountId?: string
}

/** 将 OAuth 凭据序列化为存入 apiKey 字段的 JSON 字符串。 */
export function serializeCodexCredentials(credentials: CodexOAuthCredentials): string {
  return JSON.stringify(credentials)
}

/** 从 apiKey 字段解析 OAuth 凭据；非合法 JSON 或缺少必需字段时返回 null。 */
export function parseCodexCredentials(secret: string): CodexOAuthCredentials | null {
  const trimmed = secret.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as Partial<CodexOAuthCredentials>
    if (typeof parsed.access === 'string' && parsed.access
      && typeof parsed.refresh === 'string' && parsed.refresh
      && typeof parsed.expires === 'number') {
      return {
        access: parsed.access,
        refresh: parsed.refresh,
        expires: parsed.expires,
        ...(typeof parsed.accountId === 'string' && parsed.accountId ? { accountId: parsed.accountId } : {}),
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * 判断 OAuth 凭据是否已过期或即将过期。
 *
 * 默认预留 60s 时钟偏移余量，确保 access token 在真正过期前就触发刷新，
 * 避免边界请求打出去才发现过期。
 */
export function isCodexCredentialExpired(credentials: CodexOAuthCredentials, skewMs = 60_000): boolean {
  return Date.now() >= credentials.expires - skewMs
}

/**
 * 渠道中的模型配置
 */
export interface ChannelModel {
  /** 模型唯一标识（如 claude-sonnet-4-5-20250929） */
  id: string
  /** 模型显示名称 */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 来源标记：手动添加的模型在拉取供应商列表时保留，不会被覆盖清除 */
  source?: 'manual' | 'fetched'
}

/**
 * 渠道配置
 *
 * 存储在 ~/.proma/channels.json 中，apiKey 字段为加密后的 base64 字符串
 */
export interface Channel {
  /** 渠道唯一标识 */
  id: string
  /** 渠道名称（用户自定义） */
  name: string
  /** AI 供应商类型 */
  provider: ProviderType
  /** API Base URL */
  baseUrl: string
  /** 加密后的 API Key（base64 编码） */
  apiKey: string
  /** 可用模型列表 */
  models: ChannelModel[]
  /** 是否启用 */
  enabled: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/**
 * 创建渠道时的输入数据（apiKey 为明文）
 */
export interface ChannelCreateInput {
  name: string
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key，主进程会加密后存储 */
  apiKey: string
  models: ChannelModel[]
  enabled: boolean
}

/**
 * 更新渠道时的输入数据（所有字段可选）
 */
export interface ChannelUpdateInput {
  name?: string
  provider?: ProviderType
  baseUrl?: string
  /** 明文 API Key，为空字符串表示不更新 */
  apiKey?: string
  models?: ChannelModel[]
  enabled?: boolean
}

/**
 * 渠道配置文件格式
 */
export interface ChannelsConfig {
  /** 配置版本号 */
  version: number
  /** 渠道列表 */
  channels: Channel[]
}

/**
 * 连接测试失败的归一化分类
 *
 * 以 HTTP 状态码为主轴判定；UI 可据此渲染不同提示 / 图标，
 * 而无需解析 message 字符串。
 */
export type ChannelTestErrorType =
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'rate_limit'
  | 'quota'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'unknown'

/**
 * 连接测试结果
 */
export interface ChannelTestResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息（含分类提示与脱敏后的供应商摘要） */
  message: string
  /** 归一化错误分类，成功时为空 */
  errorType?: ChannelTestErrorType
  /** HTTP 状态码，网络 / 超时等无响应异常时为空 */
  statusCode?: number
  /** 供应商原始错误摘要，已脱敏并截断 */
  detail?: string
}

/**
 * 拉取模型的输入参数（无需已保存的渠道，直接传入凭证）
 */
export interface FetchModelsInput {
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key */
  apiKey: string
}

/**
 * 直接测试渠道连接的输入参数（无需已保存的渠道，直接传入凭证）
 */
export interface ChannelDirectTestInput {
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key */
  apiKey: string
  /** 用于 messages 端点测试的模型 ID；不需要模型的供应商可忽略 */
  modelId?: string
}

/**
 * 拉取模型的结果
 */
export interface FetchModelsResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
  /** 获取到的模型列表 */
  models: ChannelModel[]
}

/**
 * 订阅 Plan 的窗口型额度。
 *
 * 用于展示类似「每 5 小时」和「每周」这类限频窗口的剩余比例。
 */
export interface ChannelPlanQuotaWindow {
  /** 窗口类型标识 */
  type: '5h' | 'weekly' | 'custom'
  /** 展示标签 */
  label: string
  /** 剩余额度百分比，0-100 */
  remainingPercent: number
  /** 已使用百分比，0-100 */
  usedPercent: number
  /** 覆盖展示值。用于余额等无法自然转成百分比的额度。 */
  remainingLabel?: string
  /** 是否展示进度条。默认展示。 */
  showProgress?: boolean
  /** 重置时间戳（毫秒） */
  resetAt?: number
}

/**
 * 渠道订阅 Plan 额度查询结果。
 */
export interface ChannelPlanQuotaResult {
  /** 当前渠道是否支持订阅额度查询 */
  supported: boolean
  /** 渠道供应商类型 */
  provider: ProviderType
  /** Plan 展示名称 */
  planName?: string
  /** 查询到的窗口额度列表 */
  windows: ChannelPlanQuotaWindow[]
  /** 查询时间戳（毫秒） */
  updatedAt: number
  /** 不支持或查询失败时的用户可读原因 */
  message?: string
}

/**
 * 渠道相关 IPC 通道常量
 */
export const CHANNEL_IPC_CHANNELS = {
  /** 获取所有渠道列表 */
  LIST: 'channel:list',
  /** 创建渠道 */
  CREATE: 'channel:create',
  /** 更新渠道 */
  UPDATE: 'channel:update',
  /** 删除渠道 */
  DELETE: 'channel:delete',
  /** 解密获取明文 API Key */
  DECRYPT_KEY: 'channel:decrypt-key',
  /** 测试渠道连接 */
  TEST: 'channel:test',
  /** 从供应商拉取可用模型列表 */
  FETCH_MODELS: 'channel:fetch-models',
  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  TEST_DIRECT: 'channel:test-direct',
  /** 查询订阅 Plan 额度 */
  GET_PLAN_QUOTA: 'channel:get-plan-quota',
  /** 发起 ChatGPT (Codex) OAuth 登录，返回加密凭据与账号信息 */
  CODEX_OAUTH_LOGIN: 'channel:codex-oauth-login',
  /** 取消进行中的 ChatGPT OAuth 登录流程 */
  CODEX_OAUTH_CANCEL: 'channel:codex-oauth-cancel',
} as const

/**
 * ChatGPT (Codex) OAuth 登录结果。
 *
 * 登录在主进程执行（Pi SDK 的 codex 流程用 Node crypto + 本地回调服务），
 * 成功后返回已加密的凭据 JSON（可直接作为 Channel.apiKey 存储）与展示信息。
 */
export interface CodexOAuthLoginResult {
  /** 是否登录成功 */
  success: boolean
  /**
   * 序列化后的凭据 JSON（明文）。与现有 apiKey 明文回传模式一致：
   * 渲染层拿到后作为 Channel.apiKey 传给 create/update，由 channel-manager 加密存储。
   */
  credentials?: string
  /** 登录账号标识，用于 UI 展示 */
  accountId?: string
  /** 失败或取消时的用户可读原因 */
  message?: string
}
