import type { WorkspaceCapabilities } from '../types/agent'

/** 单条能力变化描述 */
export interface CapabilityChange {
  /** 变化类型 */
  type:
    | 'mcp_added'
    | 'mcp_removed'
    | 'mcp_enabled'
    | 'mcp_disabled'
    | 'skill_added'
    | 'skill_removed'
    | 'skill_enabled'
    | 'skill_disabled'
  /** 变化对象名称 */
  name: string
}

/**
 * 比较新旧 WorkspaceCapabilities，返回变化列表。
 *
 * - MCP 服务器：按 name 比较集合差异（added/removed）和 enabled 状态变化
 * - Skills：按 slug 比较集合差异（added/removed）和 enabled 状态变化
 */
export function diffCapabilities(
  prev: WorkspaceCapabilities,
  next: WorkspaceCapabilities,
): CapabilityChange[] {
  const changes: CapabilityChange[] = []

  // --- MCP 服务器 ---
  const prevMcpMap = new Map(prev.mcpServers.map((s) => [s.name, s]))
  const nextMcpMap = new Map(next.mcpServers.map((s) => [s.name, s]))

  for (const [name, server] of nextMcpMap) {
    const prevServer = prevMcpMap.get(name)
    if (!prevServer) {
      changes.push({ type: 'mcp_added', name })
    } else if (prevServer.enabled !== server.enabled) {
      changes.push({ type: server.enabled ? 'mcp_enabled' : 'mcp_disabled', name })
    }
  }
  for (const name of prevMcpMap.keys()) {
    if (!nextMcpMap.has(name)) {
      changes.push({ type: 'mcp_removed', name })
    }
  }

  // --- Skills ---
  const prevSkillMap = new Map(prev.skills.map((s) => [s.slug, s]))
  const nextSkillMap = new Map(next.skills.map((s) => [s.slug, s]))

  for (const [slug, skill] of nextSkillMap) {
    const prevSkill = prevSkillMap.get(slug)
    if (!prevSkill) {
      changes.push({ type: 'skill_added', name: skill.name })
    } else if (prevSkill.enabled !== skill.enabled) {
      changes.push({ type: skill.enabled ? 'skill_enabled' : 'skill_disabled', name: skill.name })
    }
  }
  for (const [slug] of prevSkillMap) {
    if (!nextSkillMap.has(slug)) {
      const skill = prevSkillMap.get(slug)!
      changes.push({ type: 'skill_removed', name: skill.name })
    }
  }

  return changes
}
