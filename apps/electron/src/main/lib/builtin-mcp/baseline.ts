/**
 * Proma 内置 MCP 单一事实源加载层
 *
 * 唯一从 default-mcp.json 读取内置 MCP 定义的地方。注入器、UI catalog、
 * 系统提示词全部通过这里取 name / displayName / 约束，杜绝多处手写漂移。
 *
 * default-mcp.json 随构建编译进包（参考 channel-manager / agent-orchestrator
 * 的 `import pkg from 'package.json' with { type: 'json' }` 模式），
 * Proma 每次发布即覆盖升级，无需运行时同步到用户目录。
 */

import type { BuiltinMcpCategory, McpToolSummary } from '@proma/shared'
import manifest from './default-mcp.json' with { type: 'json' }

export interface BuiltinMcpDefinition {
  /** 设置 / 凭据键，历史值，向后兼容（如 'proma-cloud'、'nano-banana'） */
  id: string
  /** 运行时真实 server 名，下划线安全（= prompt = 注入 = UI 真实名） */
  name: string
  displayName: string
  description: string
  category: BuiltinMcpCategory
  /** internal=代码注入，不写入工作区 mcp.json */
  kind: 'internal'
  /** 是否允许用户删除（内置项恒为 false，删除护栏的事实源） */
  deletable: boolean
  /** 默认是否向 Agent 注入（如 mem/nano-banana 需用户手动开启） */
  defaultEnabled: boolean
  /** 是否提供开关（基础设施型如 proma-cloud 置 false） */
  toggleable: boolean
  tools: McpToolSummary[]
}

const DEFINITIONS: BuiltinMcpDefinition[] = (manifest.servers as unknown as BuiltinMcpDefinition[]).map((s) => ({
  ...s,
}))

const BY_ID = new Map<string, BuiltinMcpDefinition>(DEFINITIONS.map((d) => [d.id, d]))

/** 所有内置 MCP 定义（来自 default-mcp.json，按声明顺序） */
export function getBuiltinMcpDefinitions(): BuiltinMcpDefinition[] {
  return DEFINITIONS
}

/** 按 id 取定义 */
export function getBuiltinMcpById(id: string): BuiltinMcpDefinition | undefined {
  return BY_ID.get(id)
}

/**
 * 取某个内置 MCP 的运行时真实 server 名。
 * 注入器、catalog、prompt 一律通过此函数取名，确保和 default-mcp.json 一致。
 * 未登记的 id 回退为 id 本身（容错，不致崩溃）。
 */
export function getBuiltinMcpName(id: string): string {
  return BY_ID.get(id)?.name ?? id
}

/**
 * 内置 MCP 占用的全部保留名（id + 运行时 name）。
 * 工作区 mcp.json 不允许出现这些 key——内置项是 kind=internal，由代码注入，
 * 任何同名条目都是误写/冲突，应在保存时剔除。
 */
export const RESERVED_BUILTIN_KEYS: ReadonlySet<string> = new Set(
  DEFINITIONS.flatMap((d) => [d.id, d.name]),
)
