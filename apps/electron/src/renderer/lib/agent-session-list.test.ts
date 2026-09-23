import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import { groupArchivedAgentSessionsByProject } from './agent-session-list'

const workspace: AgentWorkspace = {
  id: 'workspace-1',
  name: '项目一',
  slug: 'project-one',
  projectRootPath: '/tmp/project-one',
  projectRootStatus: 'available',
  createdAt: 1,
  updatedAt: 1,
}

function archivedSession(
  id: string,
  updatedAt: number,
  overrides: Partial<AgentSessionMeta> = {},
): AgentSessionMeta {
  return {
    id,
    title: id,
    archived: true,
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  }
}

describe('归档 Agent 会话项目分组', () => {
  test('真实项目分组保留本地项目 badge 元数据，自动任务和未归属分组不带项目元数据', () => {
    const groups = groupArchivedAgentSessionsByProject({
      workspaces: [workspace],
      sessions: [
        archivedSession('project-session', 3, { workspaceId: workspace.id }),
        archivedSession('automation-session', 2, { sourceAutomationId: 'automation-1' }),
        archivedSession('unassigned-session', 1),
      ],
    })

    expect(groups.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: 'workspace', label: '项目一' },
      { kind: 'automation', label: '定时任务' },
      { kind: 'unassigned', label: '未归属项目' },
    ])
    expect(groups[0]?.workspace).toBe(workspace)
    expect(groups[1]?.workspace).toBeUndefined()
    expect(groups[2]?.workspace).toBeUndefined()
  })

  test('只纳入归档会话并按更新时间倒序排列', () => {
    const groups = groupArchivedAgentSessionsByProject({
      workspaces: [workspace],
      sessions: [
        archivedSession('older', 1, { workspaceId: workspace.id }),
        archivedSession('newer', 3, { workspaceId: workspace.id }),
        archivedSession('active', 4, { workspaceId: workspace.id, archived: false }),
        archivedSession('draft', 5, { workspaceId: workspace.id, isDraft: true }),
      ],
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions.map(({ id }) => id)).toEqual(['newer', 'older'])
  })
})
