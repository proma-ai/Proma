/**
 * Proma Agent Inner Key + App Key 服务
 *
 * 提供两种 Proma API Key：
 *
 * 1. Inner Key（name: 'proma-agent-inner'）
 *    - 给 Agent 内置 MCP 自用，比如生图、内部 LLM 调用
 *    - 单一 key，带 1h 进程内缓存
 *    - 用户在 Web 面板可手动删除，下次 Agent 调用自动重建
 *
 * 2. App Key（name: 'app-<appName>-<YYYYMMDD>'）
 *    - 给 Agent 帮用户生成的 AI 应用使用
 *    - 默认带 quotaLimit 防止超支
 *    - 每次调用都创建新的（不缓存），由 Agent 写入应用的 .env
 *    - 用户在面板可识别 'app-' 前缀，单独管理
 *
 * 滥用保护：
 * - 同名 'proma-agent-inner' key 数量超过 MAX_INNER_KEYS 拒绝再创建
 * - 'app-' 前缀 key 累计数量超过 MAX_APP_KEYS 拒绝再创建
 */

import { listApiKeys, createApiKey } from './cloud-api-keys-service'

// ===== Inner Key 配置 =====

/** Agent 内部使用的专用 API Key 名称 */
const INNER_KEY_NAME = 'proma-agent-inner'

/** Inner Key 描述（≤20 字） */
const INNER_KEY_DESCRIPTION = 'Proma Agent 专用，可删除（自动重建）'

/** 进程内缓存 TTL：1 小时 */
const CACHE_TTL_MS = 60 * 60 * 1000

/** 同名 inner key 数量上限（防止反复误删导致积累） */
const MAX_INNER_KEYS = 5

// ===== App Key 配置 =====

/** App Key 命名前缀 */
const APP_KEY_PREFIX = 'app-'

/** app- 前缀 key 累计数量上限 */
const MAX_APP_KEYS = 20

/** appName 合法字符（kebab-case） */
const APP_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

// ===== Inner Key 缓存 =====

interface CachedKey {
  key: string
  fetchedAt: number
}

let cachedInnerKey: CachedKey | null = null

// ===== Inner Key API =====

/**
 * 获取 Proma Agent Inner Key（必要时创建）
 *
 * @throws Error 当用户未登录、API 失败、或滥用保护触发时
 */
export async function ensurePromaAgentInnerKey(): Promise<string> {
  // 1. 缓存命中
  if (cachedInnerKey && Date.now() - cachedInnerKey.fetchedAt < CACHE_TTL_MS) {
    return cachedInnerKey.key
  }

  // 2. 列出现有 key
  const listResult = await listApiKeys()
  if (!listResult.success || !listResult.data) {
    throw new Error(
      `Failed to list API keys: ${listResult.success ? 'no data' : listResult.error}`,
    )
  }

  const candidates = listResult.data.filter(
    (k) => k.name === INNER_KEY_NAME && k.status === 'ACTIVE',
  )

  // 3. 找到现成的 → 用第一个（即使有多个也只用 ACTIVE 列表的第一个）
  if (candidates.length > 0) {
    if (candidates.length >= MAX_INNER_KEYS) {
      console.warn(
        `[ProBmaAgentKey] 检测到 ${candidates.length} 个同名 ACTIVE inner key，` +
          `可能是反复误删导致积累，请提示用户清理。`,
      )
    }
    const chosen = candidates[0]!
    cachedInnerKey = { key: chosen.key, fetchedAt: Date.now() }
    return chosen.key
  }

  // 4. 滥用保护：列表里同名 key（包括非 ACTIVE 的）超过 MAX_INNER_KEYS 拒绝再创建
  const allSameName = listResult.data.filter((k) => k.name === INNER_KEY_NAME)
  if (allSameName.length >= MAX_INNER_KEYS) {
    throw new Error(
      `Too many "${INNER_KEY_NAME}" keys (${allSameName.length} >= ${MAX_INNER_KEYS}). ` +
        `Please clean up old/disabled keys in your settings panel.`,
    )
  }

  // 5. 创建新 key
  const createResult = await createApiKey({
    name: INNER_KEY_NAME,
    description: INNER_KEY_DESCRIPTION,
  })
  if (!createResult.success || !createResult.data) {
    throw new Error(
      `Failed to create API key: ${createResult.success ? 'no data' : createResult.error}`,
    )
  }

  cachedInnerKey = { key: createResult.data.key, fetchedAt: Date.now() }
  console.log(
    `[ProBmaAgentKey] 已创建 "${INNER_KEY_NAME}" key（id=${createResult.data.id}）`,
  )
  return createResult.data.key
}

/**
 * 清空 inner key 缓存。MCP 调用收到 401 / API Key 被外部删除时调用，
 * 下次 ensurePromaAgentInnerKey 会重新走"列出 / 创建"流程。
 */
export function invalidatePromaAgentInnerKeyCache(): void {
  cachedInnerKey = null
}

// ===== App Key API =====

/** App Key 创建参数 */
export interface CreatePromaAppKeyInput {
  /** kebab-case 应用名（如 'article-polisher'），将拼到 key 名 */
  appName: string
  /** 显示给用户看的描述（建议 ≤80 字） */
  description: string
  /** 积分上限，默认 50 */
  quotaLimit?: number
}

/** App Key 创建结果 */
export interface CreatePromaAppKeyResult {
  /** pk_xxx 明文，写入应用 .env */
  apiKey: string
  /** 后端记录 id */
  keyId: string
  /** 实际生成的 name（带 app- 前缀和日期后缀） */
  keyName: string
  /** 实际设置的上限 */
  quotaLimit: number
}

/** 默认 quota 上限（积分） */
const DEFAULT_APP_QUOTA = 50

function formatTodayYYYYMMDD(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * 为 Agent 帮用户生成的 AI 应用创建专用 API Key。
 *
 * 命名规则：`app-<appName>-<YYYYMMDD>`
 * 默认 quota：50 积分（可被参数覆盖）
 *
 * @throws Error 当 appName 不合法、滥用保护触发、或 API 失败时
 */
export async function createPromaAppKey(
  input: CreatePromaAppKeyInput,
): Promise<CreatePromaAppKeyResult> {
  const { appName, description } = input
  const quotaLimit = input.quotaLimit ?? DEFAULT_APP_QUOTA

  // 1. 参数校验
  if (!APP_NAME_PATTERN.test(appName)) {
    throw new Error(
      `Invalid appName "${appName}": must be kebab-case (lowercase letters, digits, hyphens only).`,
    )
  }
  if (quotaLimit <= 0) {
    throw new Error(`Invalid quotaLimit ${quotaLimit}: must be > 0.`)
  }
  if (description.length > 200) {
    throw new Error(`description too long (${description.length} > 200 chars).`)
  }

  // 2. 列出现有 key 做滥用保护
  const listResult = await listApiKeys()
  if (!listResult.success || !listResult.data) {
    throw new Error(
      `Failed to list API keys: ${listResult.success ? 'no data' : listResult.error}`,
    )
  }

  const appKeyCount = listResult.data.filter(
    (k) => k.name.startsWith(APP_KEY_PREFIX),
  ).length
  if (appKeyCount >= MAX_APP_KEYS) {
    throw new Error(
      `Too many app keys (${appKeyCount} >= ${MAX_APP_KEYS}). ` +
        `Please clean up unused app keys in your Proma settings panel before creating new ones.`,
    )
  }

  // 3. 创建 key，命名 app-<appName>-<YYYYMMDD>
  const keyName = `${APP_KEY_PREFIX}${appName}-${formatTodayYYYYMMDD()}`
  const createResult = await createApiKey({
    name: keyName,
    description,
    quotaLimit,
  })
  if (!createResult.success || !createResult.data) {
    throw new Error(
      `Failed to create app key: ${createResult.success ? 'no data' : createResult.error}`,
    )
  }

  const data = createResult.data
  console.log(
    `[ProBmaAppKey] 已为应用创建 key: name=${keyName}, id=${data.id}, quotaLimit=${quotaLimit}`,
  )

  return {
    apiKey: data.key,
    keyId: data.id,
    keyName,
    quotaLimit,
  }
}
