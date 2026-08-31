import { describe, expect, test } from 'bun:test'
import {
  buildSearchScopePlan,
  buildGlobalSearchRequest,
  createGlobalTitleResults,
  mergeGlobalContentResults,
} from './global-search-results'

describe('全局搜索范围', () => {
  test('Given 未选择项目 When 构建搜索请求 Then 同时搜索 Chat 和全部 Agent 会话', () => {
    const request = buildGlobalSearchRequest([])

    expect(request).toEqual({
      includeChat: true,
      agentOptions: undefined,
    })
  })

  test('Given 选择多个项目 When 构建搜索请求和标题结果 Then 只搜索所选项目', () => {
    const request = buildGlobalSearchRequest(['workspace-b', 'workspace-a', 'workspace-b'])
    const results = createGlobalTitleResults({
      query: '方案',
      conversations: [{ id: 'chat-1', title: 'Chat 方案', updatedAt: 40 }],
      agentSessions: [
        { id: 'agent-a', title: 'A 方案', workspaceId: 'workspace-a', updatedAt: 20 },
        { id: 'agent-b', title: 'B 方案', workspaceId: 'workspace-b', updatedAt: 30 },
        { id: 'agent-c', title: 'C 方案', workspaceId: 'workspace-c', updatedAt: 50 },
      ],
      selectedWorkspaceIds: request.agentOptions?.workspaceIds ?? [],
    })

    expect(request).toEqual({
      includeChat: false,
      agentOptions: { workspaceIds: ['workspace-b', 'workspace-a'] },
    })
    expect(results.map((result) => result.id)).toEqual(['agent-b', 'agent-a'])
  })

  test('Given 从项目菜单打开搜索 When 构建范围策略 Then 固定当前项目且保持 PR1 的正文搜索语义', () => {
    const plan = buildSearchScopePlan({
      projectWorkspaceId: 'workspace-a',
      selectedWorkspaceIds: ['workspace-b'],
    })

    expect(plan).toEqual({
      workspaceIds: ['workspace-a'],
      includeTitleMatches: false,
    })
    expect(buildGlobalSearchRequest(plan.workspaceIds)).toEqual({
      includeChat: false,
      agentOptions: { workspaceIds: ['workspace-a'] },
    })
  })
})

describe('全局搜索结果排序', () => {
  test('Given Chat 和 Agent 包含精确、模糊及归档命中 When 合并结果 Then 与项目搜索采用相同分级排序', () => {
    const results = mergeGlobalContentResults({
      query: '搜索优化方案',
      titleResultKeys: new Set(['agent:agent-title-match']),
      chatResults: [
        {
          conversationId: 'chat-old',
          conversationTitle: '较早 Chat',
          messageId: 'chat-message',
          role: 'user',
          snippet: '搜索优化方案',
          matchStart: 0,
          matchLength: 6,
          updatedAt: 10,
        },
      ],
      agentResults: [
        {
          sessionId: 'agent-new',
          sessionTitle: '最近 Agent',
          messageId: 'agent-message',
          role: 'assistant',
          snippet: '搜索优花方案',
          matchStart: 0,
          matchLength: 6,
          updatedAt: 30,
        },
        {
          sessionId: 'agent-archived',
          sessionTitle: '归档 Agent',
          messageId: 'archived-message',
          role: 'user',
          snippet: '搜索优化方案',
          matchStart: 0,
          matchLength: 6,
          archived: true,
          updatedAt: 50,
        },
        {
          sessionId: 'agent-title-match',
          sessionTitle: '标题已命中',
          messageId: 'duplicate-message',
          role: 'user',
          snippet: '搜索优化方案',
          matchStart: 0,
          matchLength: 6,
          updatedAt: 50,
        },
      ],
    })

    expect(results.map((result) => result.id)).toEqual(['chat-old', 'agent-new', 'agent-archived'])
    expect(results.map((result) => result.matchKind)).toEqual(['exact', 'fuzzy', 'exact'])
  })
})
