import { describe, expect, test } from 'bun:test'
import { getAgentCompletionMarkers, isAgentSessionActiveForCompletion } from './agent-completion-presence'
import type { TabItem } from '@/atoms/tab-atoms'

describe('Agent 完成归属判断', () => {
  test('Given 当前激活的是同一个 Agent Tab When Agent 完成 Then 视为用户仍在查看', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '当前任务' },
    ]
    const input = {
      tabs,
      activeTabId: 'agent-1',
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: true,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(true)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: false,
    })
  })

  test('Given 当前激活的是草稿页 When 旧 Agent 完成 Then 视为后台完成', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '后台任务' },
    ]
    const input = {
      tabs,
      activeTabId: '__scratch-pad__',
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: true,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(false)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: true,
    })
  })

  test('Given Tab 状态尚未恢复但 currentAgentSessionId 匹配 When Agent 完成 Then 使用兼容判断', () => {
    expect(isAgentSessionActiveForCompletion({
      tabs: [],
      activeTabId: null,
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: true,
    })).toBe(true)
  })

  test('Given 当前激活的就是该 Agent Tab 但窗口在后台 When Agent 完成 Then 视为未查看并入账角标', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '当前任务' },
    ]
    const input = {
      tabs,
      activeTabId: 'agent-1',
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: false,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(false)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: true,
    })
  })
})
