import { describe, expect, test } from 'bun:test'
import { resolveChatMigrationWorkspaceId, type AgentSideChatContext } from './chat-atoms'

const workspaces = [{ id: 'workspace-a' }, { id: 'workspace-b' }]

function sideChats(entries: [string, AgentSideChatContext][]): Map<string, AgentSideChatContext> {
  return new Map(entries)
}

describe('右侧问答迁移工作区', () => {
  test('Given 右侧问答记录了有效来源工作区 When 解析迁移目标 Then 保留来源工作区', () => {
    const workspaceId = resolveChatMigrationWorkspaceId(
      'conversation-side',
      sideChats([['session-a', { conversationId: 'conversation-side', sourceWorkspaceId: 'workspace-b' }]]),
      'workspace-a',
      workspaces,
    )

    expect(workspaceId).toBe('workspace-b')
  })

  test('Given 来源工作区已失效 When 解析迁移目标 Then 回退到当前有效工作区', () => {
    const workspaceId = resolveChatMigrationWorkspaceId(
      'conversation-side',
      sideChats([['session-a', { conversationId: 'conversation-side', sourceWorkspaceId: 'workspace-deleted' }]]),
      'workspace-b',
      workspaces,
    )

    expect(workspaceId).toBe('workspace-b')
  })

  test('Given 普通 Chat 没有来源工作区 When 解析迁移目标 Then 使用当前有效工作区', () => {
    const workspaceId = resolveChatMigrationWorkspaceId(
      'conversation-chat',
      sideChats([]),
      'workspace-b',
      workspaces,
    )

    expect(workspaceId).toBe('workspace-b')
  })

  test('Given 当前工作区已失效 When 解析迁移目标 Then 回退到列表首项', () => {
    const workspaceId = resolveChatMigrationWorkspaceId(
      'conversation-chat',
      sideChats([]),
      'workspace-deleted',
      workspaces,
    )

    expect(workspaceId).toBe('workspace-a')
  })

  test('Given 没有可用工作区 When 解析迁移目标 Then 返回 undefined', () => {
    const workspaceId = resolveChatMigrationWorkspaceId(
      'conversation-chat',
      sideChats([]),
      null,
      [],
    )

    expect(workspaceId).toBeUndefined()
  })
})
