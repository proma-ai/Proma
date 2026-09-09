/**
 * 工作区 MCP 配置的纯策略函数。
 *
 * 不依赖 Electron、文件系统或网络，供受控 Agent 配置服务与单元测试共用。
 */

import type { McpOAuthConfiguration, McpServerEntry, McpTransportType } from '@proma/shared'
import { RESERVED_BUILTIN_KEYS } from './builtin-mcp/baseline'

export interface ConfigureWorkspaceMcpInput {
  name: string
  type: McpTransportType
  command?: string
  args?: string[]
  url?: string
  timeout?: number
  /** 默认为 true；启用时会先验证，失败条目会以 disabled 状态保存。 */
  enabled?: boolean
  /** Agent 可写入的公开 OAuth 参数；绝不包含 client secret 或 token。 */
  oauth?: McpOAuthConfiguration
  /** 仅在用户已确认覆盖已有 MCP 的连接配置时传入。 */
  replaceExisting?: boolean
}

export function requireWorkspaceMcpServerName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('MCP 服务名不能为空')
  if (RESERVED_BUILTIN_KEYS.has(normalized)) throw new Error(`MCP 服务名 ${normalized} 是 Proma 运行时保留名`)
  if (normalized.length > 120) throw new Error('MCP 服务名不能超过 120 个字符')
  if (/\p{C}/u.test(normalized)) throw new Error('MCP 服务名不能包含控制字符')
  return normalized
}

function normalizeOAuthConfiguration(oauth: McpOAuthConfiguration | undefined): McpOAuthConfiguration | undefined {
  if (!oauth) return undefined
  const normalizeUrl = (value: string | undefined, field: string): string | undefined => {
    if (!value?.trim()) return undefined
    let parsed: URL
    try {
      parsed = new URL(value.trim())
    } catch {
      throw new Error(`OAuth ${field} 不是有效 URL`)
    }
    if (parsed.protocol !== 'https:') throw new Error(`OAuth ${field} 必须使用 HTTPS`)
    return parsed.toString()
  }
  const provider = oauth.provider?.trim()
  const clientId = oauth.clientId?.trim()
  const scopes = oauth.scopes?.map((scope) => scope.trim()).filter(Boolean)
  const authorizationEndpoint = normalizeUrl(oauth.authorizationEndpoint, 'authorizationEndpoint')
  const tokenEndpoint = normalizeUrl(oauth.tokenEndpoint, 'tokenEndpoint')
  const registrationEndpoint = normalizeUrl(oauth.registrationEndpoint, 'registrationEndpoint')
  const normalized = {
    ...(provider ? { provider } : {}),
    ...(authorizationEndpoint ? { authorizationEndpoint } : {}),
    ...(tokenEndpoint ? { tokenEndpoint } : {}),
    ...(registrationEndpoint ? { registrationEndpoint } : {}),
    ...(clientId ? { clientId } : {}),
    ...(oauth.clientSecretRequired === true ? { clientSecretRequired: true } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/** 将 Agent 输入收敛为无凭据的 MCP transport 配置。 */
export function buildWorkspaceMcpEntry(input: ConfigureWorkspaceMcpInput): McpServerEntry {
  const timeout = input.timeout == null ? undefined : Math.max(1, Math.floor(input.timeout))
  const oauth = normalizeOAuthConfiguration(input.oauth)
  if (input.type === 'stdio') {
    const command = input.command?.trim()
    if (!command) throw new Error('stdio MCP 需要 command')
    const args = input.args?.map((arg) => arg.trim()).filter(Boolean)
    return {
      type: 'stdio',
      command,
      ...(args && args.length > 0 ? { args } : {}),
      ...(timeout ? { timeout } : {}),
      ...(oauth ? { oauth } : {}),
      enabled: input.enabled !== false,
    }
  }

  const url = input.url?.trim()
  if (!url) throw new Error(`${input.type} MCP 需要 url`)
  try {
    new URL(url)
  } catch {
    throw new Error(`无效的 MCP URL: ${url}`)
  }
  return {
    type: input.type,
    url,
    ...(timeout ? { timeout } : {}),
    ...(oauth ? { oauth } : {}),
    enabled: input.enabled !== false,
  }
}

/**
 * Agent 输入从不接触密钥；更新同一 transport 时保留 UI/Keychain 管理流程已写入的
 * env 或 headers，避免一次普通地址更新意外清除现有认证配置。
 */
export function preserveSensitiveConnectionFields(previous: McpServerEntry | undefined, next: McpServerEntry): McpServerEntry {
  if (!previous || previous.type !== next.type) return next
  if (next.type === 'stdio' && previous.env) return { ...next, env: previous.env }
  if ((next.type === 'http' || next.type === 'sse') && previous.headers) return { ...next, headers: previous.headers }
  return next
}

/** 比较 Agent 有权管理的非敏感 transport 字段，不把凭据和上次测试结果算作变更。 */
export function hasWorkspaceMcpTransportChanged(previous: McpServerEntry, next: McpServerEntry): boolean {
  if (previous.type !== next.type || previous.timeout !== next.timeout || JSON.stringify(previous.oauth) !== JSON.stringify(next.oauth)) return true
  if (next.type === 'stdio') {
    const previousArgs = previous.args ?? []
    const nextArgs = next.args ?? []
    return previous.command !== next.command
      || previousArgs.length !== nextArgs.length
      || previousArgs.some((arg, index) => arg !== nextArgs[index])
  }
  return previous.url !== next.url
}
