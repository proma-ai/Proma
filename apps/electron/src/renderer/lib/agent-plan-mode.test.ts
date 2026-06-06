import { describe, expect, test } from 'bun:test'
import { getPlanModeChangeFromToolName, updatePlanModeSessionSet } from './agent-plan-mode'

describe('Agent 计划阶段状态', () => {
  test('Given EnterPlanMode 工具 When 解析计划状态 Then 标记进入计划阶段', () => {
    expect(getPlanModeChangeFromToolName('EnterPlanMode')).toEqual({
      active: true,
      source: 'tool',
    })
  })

  test('Given ExitPlanMode 工具 When 解析计划状态 Then 不直接标记离开计划阶段', () => {
    expect(getPlanModeChangeFromToolName('ExitPlanMode')).toBeNull()
  })

  test('Given 普通工具 When 解析计划状态 Then 不产生状态变化', () => {
    expect(getPlanModeChangeFromToolName('Read')).toBeNull()
  })

  test('Given 会话进入计划阶段 When 更新集合 Then 只新增目标会话', () => {
    const prev = new Set(['session-a'])
    const next = updatePlanModeSessionSet(prev, 'session-b', true)

    expect([...next].sort()).toEqual(['session-a', 'session-b'])
    expect(next).not.toBe(prev)
  })

  test('Given 会话离开计划阶段 When 更新集合 Then 只移除目标会话', () => {
    const prev = new Set(['session-a', 'session-b'])
    const next = updatePlanModeSessionSet(prev, 'session-b', false)

    expect([...next]).toEqual(['session-a'])
    expect(next).not.toBe(prev)
  })

  test('Given 状态没有变化 When 更新集合 Then 复用原集合', () => {
    const prev = new Set(['session-a'])

    expect(updatePlanModeSessionSet(prev, 'session-a', true)).toBe(prev)
    expect(updatePlanModeSessionSet(prev, 'session-b', false)).toBe(prev)
  })
})
