export interface CuaDriverAutomationSettings {
  /** cua-driver 可执行文件路径；留空时优先使用 Proma 内置版本，其次查找用户目录和 PATH。 */
  path?: string
  /** MCP server 启动超时秒数，默认 15。 */
  startupTimeoutSec?: number
}

export interface DesktopAutomationSettings {
  /** 是否把桌面控制工具注入给 Agent。默认 false。 */
  enabled?: boolean
  cuaDriver?: CuaDriverAutomationSettings
}

export type CuaDriverRuntimeSource = 'env' | 'configured' | 'bundled' | 'user-local' | 'path'

export interface CuaDriverDetectionCliStatus {
  ok: boolean
  path: string
  source: CuaDriverRuntimeSource
  version?: string
  error?: string
}

export interface CuaDriverDetectedTool {
  name: string
  description?: string
}

export interface CuaDriverDetectionMcpStatus {
  ok: boolean
  toolCount: number
  tools: CuaDriverDetectedTool[]
  error?: string
}

export interface CuaDriverDetectionManifestStatus {
  ok: boolean
  mcpCommand?: string
  mcpArgs?: string[]
  error?: string
}

export interface CuaDriverDetectionResult {
  ok: boolean
  checkedAt: number
  cli: CuaDriverDetectionCliStatus
  manifest: CuaDriverDetectionManifestStatus
  mcp: CuaDriverDetectionMcpStatus
  hints: string[]
}
