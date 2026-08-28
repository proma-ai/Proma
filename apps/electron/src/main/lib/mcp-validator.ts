/**
 * MCP 服务器验证器
 *
 * 在将 MCP 服务器配置传递给 Agent SDK 之前，验证其可用性：
 * - stdio 类型：检查命令是否存在
 * - http/sse 类型：可选地 ping URL
 *
 * 避免配置错误的 MCP 服务器导致整个 Agent SDK 无法启动。
 */

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createManagedProxyFetch } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { normalizeMcpTransportType } from '@proma/shared'
import type { McpServerEntry } from '@proma/shared'
import { getMcpOAuthHeaders } from './mcp-oauth-service'

/**
 * MCP 验证结果
 */
export interface McpValidationResult {
  /** 服务器名称 */
  name: string
  /** 是否验证通过 */
  valid: boolean
  /** 成功或失败的可读结果 */
  message?: string
  /** 失败原因（如果 valid 为 false） */
  reason?: string
}

/**
 * 验证单个 MCP 服务器配置
 *
 * @param name 服务器名称
 * @param entry MCP 服务器配置
 * @returns 验证结果
 */
export async function validateMcpServer(
  name: string,
  entry: McpServerEntry,
  workspaceSlug?: string,
): Promise<McpValidationResult> {
  const type = normalizeMcpTransportType((entry as { type?: unknown }).type)

  if (!type) {
    return { name, valid: false, reason: `未知的传输类型: ${String((entry as { type?: unknown }).type)}` }
  }

  if (type === 'stdio' && (!entry.command || !(await isCommandAvailable(entry.command)))) {
    return { name, valid: false, reason: entry.command ? `命令不存在或不可执行: ${entry.command}` : '缺少 command 字段' }
  }

  if ((type === 'http' || type === 'sse') && !entry.url) {
    return { name, valid: false, reason: '缺少 url 字段' }
  }

  if (type === 'http' || type === 'sse') {
    try {
      new URL(entry.url!)
    } catch {
      return { name, valid: false, reason: `无效的 URL 格式: ${entry.url}` }
    }
  }

  const client = new Client({ name: 'Proma MCP validator', version: '1.0.0' }, { capabilities: {} })
  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | undefined
  const timeoutMs = Math.max(1, entry.timeout ?? 30) * 1000

  let proxyFetch: ReturnType<typeof createManagedProxyFetch> | undefined

  try {
    proxyFetch = (type === 'http' || type === 'sse')
      ? createManagedProxyFetch(await getEffectiveProxyUrl())
      : undefined

    if (type === 'stdio') {
      const env = {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(entry.env ?? {}),
      }
      transport = new StdioClientTransport({ command: entry.command!, args: entry.args, env, stderr: 'pipe' })
    } else {
      const oauthHeaders = workspaceSlug ? await getMcpOAuthHeaders(workspaceSlug, name, entry.url!) : undefined
      const headers = { ...(entry.headers ?? {}), ...(oauthHeaders ?? {}) }
      const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined
      if (type === 'http') transport = new StreamableHTTPClientTransport(new URL(entry.url!), { requestInit, fetch: proxyFetch?.fetch })
      else transport = new SSEClientTransport(new URL(entry.url!), { requestInit, fetch: proxyFetch?.fetch })
    }

    await client.connect(transport, { timeout: timeoutMs })
    const result = await client.listTools(undefined, { timeout: timeoutMs })
    return { name, valid: true, message: `MCP 握手成功，发现 ${result.tools.length} 个工具` }
  } catch (error) {
    return { name, valid: false, reason: error instanceof Error ? error.message : 'MCP 握手或工具发现失败' }
  } finally {
    try { await transport?.close() } catch { /* 验证结束时忽略关闭错误 */ }
    await proxyFetch?.close()
  }
}

/**
 * 检查命令是否可用
 *
 * 策略：
 * 1. 如果是绝对路径，检查文件是否存在
 * 2. 如果是相对命令（如 npx），使用 which 查找
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  // 绝对路径
  if (command.startsWith('/') || command.startsWith('\\') || /^[A-Z]:/i.test(command)) {
    return existsSync(command)
  }

  // 相对命令：使用 which 查找。使用参数数组，避免 MCP 配置中的命令名进入 shell。
  try {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which'
    execFileSync(whichCommand, [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * 批量验证 MCP 服务器配置
 *
 * @param servers MCP 服务器配置对象
 * @returns 验证结果数组
 */
export async function validateMcpServers(
  servers: Record<string, McpServerEntry>,
  workspaceSlug?: string,
): Promise<McpValidationResult[]> {
  const results: McpValidationResult[] = []

  for (const [name, entry] of Object.entries(servers)) {
    // 跳过未启用的服务器
    if (!entry.enabled) continue

    const result = await validateMcpServer(name, entry, workspaceSlug)
    results.push(result)
  }

  return results
}
