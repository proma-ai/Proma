/**
 * Pi Runtime 用户 MCP 工具桥接层
 *
 * Claude runtime 继续使用 Claude Agent SDK 原生 mcpServers；Pi SDK 当前没有等价
 * mcpServers 参数，因此 Proma 在主进程连接用户配置的 MCP server，并把 MCP tools
 * 映射成 Pi customTools。
 */

import { createHash } from 'node:crypto'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { TextContent, ImageContent } from '@earendil-works/pi-ai'
import type { TSchema } from 'typebox'
import { Type } from 'typebox'

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 30_000

interface PiMcpServerConfig {
  type?: unknown
  command?: unknown
  args?: unknown
  env?: unknown
  url?: unknown
  headers?: unknown
  startup_timeout_sec?: unknown
  timeout?: unknown
}

type PiMcpServers = Record<string, Record<string, unknown>>

type McpToolInfo = Awaited<ReturnType<Client['listTools']>>['tools'][number]

type McpCallToolResult = Awaited<ReturnType<Client['callTool']>>

interface McpConnection {
  client: Client
  transport: Transport
  tools?: McpToolInfo[]
}

interface McpToolBinding {
  serverName: string
  originalToolName: string
  tool: McpToolInfo
  manager: PiMcpClientManager
  managerConfig: PiMcpServerConfig
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
}

function configHash(config: unknown): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex').slice(0, 16)
}

function normalizeToolSegment(segment: string): string {
  const normalized = segment.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (!normalized) return 'unnamed'
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`
}

function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeToolSegment(serverName)}__${normalizeToolSegment(toolName)}`
}

function getHeaders(config: PiMcpServerConfig): Record<string, string> | undefined {
  if (!config.headers || typeof config.headers !== 'object') return undefined
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.headers as Record<string, unknown>)) {
    if (typeof value === 'string') headers[key] = value
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

function getTimeoutMs(config: PiMcpServerConfig): number {
  const timeoutSec = typeof config.startup_timeout_sec === 'number'
    ? config.startup_timeout_sec
    : typeof config.timeout === 'number'
      ? config.timeout
      : undefined
  if (!timeoutSec || !Number.isFinite(timeoutSec) || timeoutSec <= 0) return DEFAULT_MCP_STARTUP_TIMEOUT_MS
  return timeoutSec * 1000
}

function createTransport(name: string, config: PiMcpServerConfig): Transport | undefined {
  const type = config.type
  if (type === 'stdio') {
    if (typeof config.command !== 'string' || !config.command.trim()) {
      console.warn(`[Pi MCP] MCP 服务器 ${name} 缺少 command，已跳过`)
      return undefined
    }
    const env = typeof config.env === 'object' && config.env
      ? Object.fromEntries(Object.entries(config.env as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>
      : undefined
    return new StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
      env,
      stderr: 'inherit',
    })
  }

  if (type === 'http') {
    if (typeof config.url !== 'string' || !config.url.trim()) {
      console.warn(`[Pi MCP] MCP 服务器 ${name} 缺少 url，已跳过`)
      return undefined
    }
    const headers = getHeaders(config)
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: headers ? { headers } : undefined,
    })
  }

  if (type === 'sse') {
    if (typeof config.url !== 'string' || !config.url.trim()) {
      console.warn(`[Pi MCP] MCP 服务器 ${name} 缺少 url，已跳过`)
      return undefined
    }
    const headers = getHeaders(config)
    return new SSEClientTransport(new URL(config.url), {
      requestInit: headers ? { headers } : undefined,
      eventSourceInit: headers
        ? ({
          fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              ...headers,
            },
          }),
        } as any)
        : undefined,
    })
  }

  console.warn(`[Pi MCP] MCP 服务器 ${name} 使用暂不支持的类型 ${String(type)}，已跳过`)
  return undefined
}

function isObjectSchema(schema: unknown): schema is Record<string, unknown> {
  return !!schema && typeof schema === 'object' && !Array.isArray(schema)
}

function toTypeBoxSchema(schema: unknown): TSchema {
  if (!isObjectSchema(schema)) return Type.Object({})
  if (schema.type !== 'object') return Type.Object({})
  return Type.Unsafe(schema)
}

function stringifyForTool(content: unknown): string {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

function convertMcpResult(result: McpCallToolResult): AgentToolResult<unknown> {
  const content: Array<TextContent | ImageContent> = []

  if ('content' in result && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text })
      } else if (block.type === 'image') {
        content.push({ type: 'image', data: block.data, mimeType: block.mimeType })
      } else {
        content.push({ type: 'text', text: stringifyForTool(block) })
      }
    }
  } else if ('toolResult' in result) {
    content.push({ type: 'text', text: stringifyForTool(result.toolResult) })
  }

  if ('structuredContent' in result && result.structuredContent !== undefined) {
    content.push({ type: 'text', text: `structuredContent:\n${stringifyForTool(result.structuredContent)}` })
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: stringifyForTool(result) })
  }

  if ('isError' in result && result.isError) {
    content.unshift({ type: 'text', text: 'MCP tool returned isError=true.' })
  }

  return {
    content,
    details: result,
  } as AgentToolResult<unknown>
}

class PiMcpClientManager {
  private readonly connections = new Map<string, Promise<McpConnection>>()

  /**
   * 关闭所有活跃的 MCP 连接，释放 stdio 子进程和网络资源。
   * 应在 app quit 或 agent session 结束时调用。
   */
  async dispose(): Promise<void> {
    const entries = [...this.connections.entries()]
    this.connections.clear()
    await Promise.allSettled(
      entries.map(async ([, connPromise]) => {
        try {
          const conn = await connPromise
          await conn.transport.close()
        } catch {
          // 连接本身就失败了，忽略
        }
      }),
    )
  }

  async listTools(serverName: string, config: PiMcpServerConfig): Promise<McpToolInfo[]> {
    const connection = await this.getConnection(serverName, config)
    if (connection.tools) return connection.tools
    const result = await connection.client.listTools(undefined, { timeout: DEFAULT_MCP_REQUEST_TIMEOUT_MS })
    connection.tools = result.tools
    return result.tools
  }

  async callTool(serverName: string, config: PiMcpServerConfig, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallToolResult> {
    const connection = await this.getConnection(serverName, config)
    return connection.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal, timeout: DEFAULT_MCP_REQUEST_TIMEOUT_MS, resetTimeoutOnProgress: true },
    )
  }

  private async getConnection(serverName: string, config: PiMcpServerConfig): Promise<McpConnection> {
    const key = `${serverName}:${configHash(config)}`
    const existing = this.connections.get(key)
    if (existing) return existing

    const connectionPromise = this.createConnection(serverName, config, key).catch((error) => {
      this.connections.delete(key)
      throw error
    })
    this.connections.set(key, connectionPromise)
    return connectionPromise
  }

  private async createConnection(serverName: string, config: PiMcpServerConfig, key: string): Promise<McpConnection> {
    const transport = createTransport(serverName, config)
    if (!transport) throw new Error(`无法创建 MCP transport: ${serverName}`)

    const client = new Client({ name: 'proma-pi-agent-mcp-bridge', version: '0.1.0' }, { capabilities: {} })
    await client.connect(transport, { timeout: getTimeoutMs(config) })

    const previousOnError = transport.onerror
    transport.onerror = (error) => {
      previousOnError?.(error)
      console.warn(`[Pi MCP] MCP 服务器 ${serverName} transport error:`, error)
    }
    const previousOnClose = transport.onclose
    transport.onclose = () => {
      previousOnClose?.()
      this.connections.delete(key)
    }

    return { client, transport }
  }
}

const manager = new PiMcpClientManager()

function createPiMcpToolDefinition(binding: McpToolBinding): ToolDefinition {
  const toolName = mcpToolName(binding.serverName, binding.originalToolName)
  const description = binding.tool.description || `Call MCP tool ${binding.originalToolName} from server ${binding.serverName}`

  return {
    name: toolName,
    label: toolName,
    description,
    promptSnippet: `${toolName}: ${description}`,
    parameters: toTypeBoxSchema(binding.tool.inputSchema),
    async execute(_toolCallId, params, signal) {
      const args = isObjectSchema(params) ? params as Record<string, unknown> : {}
      const result = await binding.manager.callTool(binding.serverName, binding.managerConfig, binding.originalToolName, args, signal)
      return convertMcpResult(result)
    },
  } as ToolDefinition
}

/**
 * 将 Proma 已构建的 MCP server 配置转换为 Pi customTools。
 *
 * 注意：本函数仅供 Pi runtime 使用；Claude runtime 仍直接把 mcpServers 交给
 * Claude Agent SDK，不经过这里。
 */
export async function buildPiMcpTools(mcpServers: PiMcpServers): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = []
  const seenToolNames = new Set<string>()

  // 并行连接所有 MCP 服务器，避免串行等待导致启动慢
  const entries = Object.entries(mcpServers).filter(([, rawConfig]) => {
    const type = (rawConfig as PiMcpServerConfig).type
    return type === 'stdio' || type === 'http' || type === 'sse'
  })

  const results = await Promise.allSettled(
    entries.map(async ([serverName, rawConfig]) => {
      const config = rawConfig as PiMcpServerConfig
      const mcpTools = await manager.listTools(serverName, config)
      return { serverName, config, mcpTools }
    }),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[Pi MCP] 连接或列出 MCP 服务器工具失败，已跳过:', result.reason)
      continue
    }
    const { serverName, config, mcpTools } = result.value
    for (const tool of mcpTools) {
      const piToolName = mcpToolName(serverName, tool.name)
      if (seenToolNames.has(piToolName)) {
        console.warn(`[Pi MCP] 工具名冲突 ${piToolName}，已跳过 ${serverName}/${tool.name}`)
        continue
      }
      seenToolNames.add(piToolName)
      tools.push(createPiMcpToolDefinition({
        serverName,
        originalToolName: tool.name,
        tool,
        manager,
        managerConfig: config,
      }))
    }
  }

  if (tools.length > 0) {
    console.log(`[Pi MCP] 已桥接 ${tools.length} 个用户 MCP 工具到 Pi customTools`)
  }

  return tools
}

/**
 * 关闭所有 MCP 连接。应在 app quit 时调用以清理 stdio 子进程。
 */
export async function disposePiMcpConnections(): Promise<void> {
  await manager.dispose()
}
