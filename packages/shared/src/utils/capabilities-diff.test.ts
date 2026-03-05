import { test, expect, describe } from 'bun:test'
import { diffCapabilities } from './capabilities-diff'
import type { WorkspaceCapabilities } from '../types/agent'

/** 构建测试用 WorkspaceCapabilities */
function makeCaps(
  mcpServers: Array<{ name: string; enabled: boolean }> = [],
  skills: Array<{ slug: string; name: string; enabled: boolean }> = [],
): WorkspaceCapabilities {
  return {
    mcpServers: mcpServers.map((s) => ({ ...s, type: 'stdio' as const })),
    skills: skills.map((s) => ({ ...s })),
  }
}

describe('diffCapabilities', () => {
  test('无变化返回空数组', () => {
    const caps = makeCaps(
      [{ name: 'github', enabled: true }],
      [{ slug: 'review', name: 'Code Review', enabled: true }],
    )
    expect(diffCapabilities(caps, caps)).toEqual([])
  })

  test('两个空 capabilities 返回空数组', () => {
    const empty = makeCaps()
    expect(diffCapabilities(empty, empty)).toEqual([])
  })

  // --- MCP 服务器 ---

  test('检测 MCP 服务器新增', () => {
    const prev = makeCaps()
    const next = makeCaps([{ name: 'github', enabled: true }])
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'mcp_added', name: 'github' }])
  })

  test('检测 MCP 服务器移除', () => {
    const prev = makeCaps([{ name: 'github', enabled: true }])
    const next = makeCaps()
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'mcp_removed', name: 'github' }])
  })

  test('检测 MCP 服务器启用', () => {
    const prev = makeCaps([{ name: 'github', enabled: false }])
    const next = makeCaps([{ name: 'github', enabled: true }])
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'mcp_enabled', name: 'github' }])
  })

  test('检测 MCP 服务器禁用', () => {
    const prev = makeCaps([{ name: 'github', enabled: true }])
    const next = makeCaps([{ name: 'github', enabled: false }])
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'mcp_disabled', name: 'github' }])
  })

  // --- Skills ---

  test('检测 Skill 新增', () => {
    const prev = makeCaps()
    const next = makeCaps([], [{ slug: 'review', name: 'Code Review', enabled: true }])
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'skill_added', name: 'Code Review' }])
  })

  test('检测 Skill 移除', () => {
    const prev = makeCaps([], [{ slug: 'review', name: 'Code Review', enabled: true }])
    const next = makeCaps()
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'skill_removed', name: 'Code Review' }])
  })

  test('检测 Skill 启用', () => {
    const prev = makeCaps([], [{ slug: 'review', name: 'Code Review', enabled: false }])
    const next = makeCaps([], [{ slug: 'review', name: 'Code Review', enabled: true }])
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'skill_enabled', name: 'Code Review' }])
  })

  test('检测 Skill 禁用', () => {
    const prev = makeCaps([], [{ slug: 'review', name: 'Code Review', enabled: true }])
    const next = makeCaps([], [{ slug: 'review', name: 'Code Review', enabled: false }])
    const changes = diffCapabilities(prev, next)
    expect(changes).toEqual([{ type: 'skill_disabled', name: 'Code Review' }])
  })

  // --- 混合场景 ---

  test('检测多个同时变化', () => {
    const prev = makeCaps(
      [{ name: 'github', enabled: true }, { name: 'slack', enabled: true }],
      [{ slug: 'review', name: 'Code Review', enabled: true }],
    )
    const next = makeCaps(
      [{ name: 'github', enabled: false }, { name: 'jira', enabled: true }],
      [{ slug: 'review', name: 'Code Review', enabled: false }, { slug: 'test', name: 'Test Runner', enabled: true }],
    )
    const changes = diffCapabilities(prev, next)

    expect(changes).toContainEqual({ type: 'mcp_disabled', name: 'github' })
    expect(changes).toContainEqual({ type: 'mcp_added', name: 'jira' })
    expect(changes).toContainEqual({ type: 'mcp_removed', name: 'slack' })
    expect(changes).toContainEqual({ type: 'skill_disabled', name: 'Code Review' })
    expect(changes).toContainEqual({ type: 'skill_added', name: 'Test Runner' })
    expect(changes).toHaveLength(5)
  })
})
