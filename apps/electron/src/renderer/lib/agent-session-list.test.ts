import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import {
  isAgentSessionProjectRestoreCandidate,
  resolveAgentSessionWorkspaceId,
} from './agent-session-list'

const workspaces = [
  { id: 'workspace-default', slug: 'default', name: '默认项目' },
  { id: 'workspace-other', slug: 'other', name: '其他项目' },
] as AgentWorkspace[]

function session(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id: 'session-a',
    title: 'Session A',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as AgentSessionMeta
}

describe('project session restoration', () => {
  test('assigns missing and deleted workspace sessions to the default project', () => {
    expect(resolveAgentSessionWorkspaceId(session(), workspaces)).toBe('workspace-default')
    expect(resolveAgentSessionWorkspaceId(session({ workspaceId: 'deleted-workspace' }), workspaces))
      .toBe('workspace-default')
    expect(resolveAgentSessionWorkspaceId(session({ workspaceId: 'workspace-other' }), workspaces))
      .toBe('workspace-other')
  })

  test('only restores normal project history sessions', () => {
    const excludedIds = new Set(['draft-id'])

    expect(isAgentSessionProjectRestoreCandidate(session(), excludedIds)).toBe(true)
    expect(isAgentSessionProjectRestoreCandidate(session({ archived: true }), excludedIds)).toBe(false)
    expect(isAgentSessionProjectRestoreCandidate(session({ pinned: true }), excludedIds)).toBe(false)
    expect(isAgentSessionProjectRestoreCandidate(session({ isDraft: true }), excludedIds)).toBe(false)
    expect(isAgentSessionProjectRestoreCandidate(session({ id: 'draft-id' }), excludedIds)).toBe(false)
    expect(isAgentSessionProjectRestoreCandidate(session({ sourceAutomationId: 'automation-a' }), excludedIds)).toBe(false)
    expect(isAgentSessionProjectRestoreCandidate(session({
      sourceAutomationId: 'automation-a',
      automationGraduated: true,
    }), excludedIds)).toBe(true)
  })

  test('never restores a delegated child, while keeping manual child navigation independent', () => {
    expect(isAgentSessionProjectRestoreCandidate(session({
      parentSessionId: 'parent-a',
      sourceDelegationId: 'delegation-a',
    }), new Set())).toBe(false)
  })
})
