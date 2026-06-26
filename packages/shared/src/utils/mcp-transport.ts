import type { McpTransportType } from '../types/agent'

const STREAMABLE_HTTP_ALIASES = new Set([
  'streamableHttp',
  'streamable-http',
  'streamable_http',
])

export function normalizeMcpTransportType(type: unknown): McpTransportType | null {
  if (type === 'stdio' || type === 'http' || type === 'sse') {
    return type
  }

  if (typeof type === 'string' && STREAMABLE_HTTP_ALIASES.has(type)) {
    return 'http'
  }

  return null
}

export function inferMcpTransportType(entry: {
  command?: unknown
  url?: unknown
}): McpTransportType {
  if (typeof entry.command === 'string' && entry.command.trim()) {
    return 'stdio'
  }

  if (typeof entry.url === 'string' && entry.url.trim()) {
    return 'http'
  }

  return 'stdio'
}
