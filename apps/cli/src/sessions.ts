/**
 * 会话索引读取（electron-free）。
 *
 * 与主进程 agent-session-manager.ts 的 readIndex/listAgentSessions 等价，
 * 但不依赖 electron——直接读 <configDir>/agent-sessions.json。CLI 只做只读，
 * 不写索引（导出/清洗不修改用户数据）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { AgentSessionMeta } from '@proma/shared'
import { getSessionsIndexPath, getSessionMessagesPath, type PathOptions } from './paths'

interface AgentSessionsIndex {
  version: number
  sessions: AgentSessionMeta[]
}

/** 读取会话索引；文件不存在或损坏时返回空列表。 */
export function readSessionIndex(opts: PathOptions = {}): AgentSessionMeta[] {
  const indexPath = getSessionsIndexPath(opts)
  if (!existsSync(indexPath)) return []
  try {
    const data = JSON.parse(readFileSync(indexPath, 'utf-8')) as AgentSessionsIndex
    return Array.isArray(data?.sessions) ? data.sessions : []
  } catch {
    return []
  }
}

/** 列出会话，按 updatedAt 降序（无 updatedAt 的排后）。 */
export function listSessions(opts: PathOptions = {}): AgentSessionMeta[] {
  return readSessionIndex(opts).sort(
    (a, b) => ((b as { updatedAt?: number }).updatedAt ?? 0) - ((a as { updatedAt?: number }).updatedAt ?? 0),
  )
}

export function getSessionMeta(id: string, opts: PathOptions = {}): AgentSessionMeta | undefined {
  return readSessionIndex(opts).find((s) => s.id === id)
}

export interface ResolvedSession {
  id: string
  filePath: string
  meta?: AgentSessionMeta
  /** JSONL 文件字节数（不存在为 undefined）。 */
  bytes?: number
}

/**
 * 把用户给的 target 解析为会话文件：
 *   - 形如已存在的 .jsonl 路径 → 直接用
 *   - 否则当作 session id，定位 <configDir>/agent-sessions/<id>.jsonl
 * 解析失败（文件不存在）返回 undefined，由命令层报错。
 */
export function resolveSession(target: string, opts: PathOptions = {}): ResolvedSession | undefined {
  // 直接文件路径
  if (target.endsWith('.jsonl') && existsSync(target)) {
    const id = target.replace(/\.jsonl$/, '').split('/').pop() ?? target
    return { id, filePath: target, meta: getSessionMeta(id, opts), bytes: safeBytes(target) }
  }
  // 当作 session id
  const filePath = getSessionMessagesPath(target, opts)
  if (!existsSync(filePath)) return undefined
  return { id: target, filePath, meta: getSessionMeta(target, opts), bytes: safeBytes(filePath) }
}

function safeBytes(path: string): number | undefined {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}
