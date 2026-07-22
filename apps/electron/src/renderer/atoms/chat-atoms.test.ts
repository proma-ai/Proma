import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { resolveSideChatWorkspaceId } from './chat-atoms'

function makeSession(id: string, workspaceId?: string): AgentSessionMeta {
  return {
    id,
    title: id,
    createdAt: 0,
    updatedAt: 0,
    workspaceId,
  }
}

describe('resolveSideChatWorkspaceId', () => {
  test('Given 右侧问答关联源会话 When 解析工作区 Then 返回源会话的工作区', () => {
    const workspaceId = resolveSideChatWorkspaceId(
      'conversation-side',
      new Map([['session-a', 'conversation-side']]),
      [makeSession('session-a', 'workspace-b')],
    )

    expect(workspaceId).toBe('workspace-b')
  })

  test('Given 对话没有右侧问答关联 When 解析工作区 Then 返回 undefined', () => {
    const workspaceId = resolveSideChatWorkspaceId(
      'conversation-chat',
      new Map([['session-a', 'conversation-side']]),
      [makeSession('session-a', 'workspace-a')],
    )

    expect(workspaceId).toBeUndefined()
  })

  test('Given 右侧问答关联的源会话已不存在 When 解析工作区 Then 返回 undefined', () => {
    const workspaceId = resolveSideChatWorkspaceId(
      'conversation-side',
      new Map([['session-missing', 'conversation-side']]),
      [makeSession('session-a', 'workspace-a')],
    )

    expect(workspaceId).toBeUndefined()
  })
})
