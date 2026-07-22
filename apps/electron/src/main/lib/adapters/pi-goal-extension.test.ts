import { describe, expect, test } from 'bun:test'
import {
  GOAL_MAX_TURNS,
  GOAL_STATE_ENTRY_TYPE,
  getLatestGoalState,
  type PromaGoalState,
} from './pi-goal-extension'

interface GoalBranchEntry {
  type: 'custom'
  customType: string
  data: unknown
}

describe('Proma goal state', () => {
  test('uses the latest state entry on the current branch', () => {
    const active: PromaGoalState = {
      id: 'goal-1',
      task: 'ship feature',
      status: 'active',
      turnCount: 2,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:02:00.000Z',
    }
    const stopped: PromaGoalState = {
      ...active,
      status: 'stopped',
      updatedAt: '2026-07-22T00:03:00.000Z',
    }
    const branch: GoalBranchEntry[] = [
      { type: 'custom', customType: 'other', data: {} },
      { type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: active },
      { type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: stopped },
    ]

    expect(getLatestGoalState(branch)).toEqual(stopped)
  })

  test('ignores malformed goal state entries', () => {
    const branch: GoalBranchEntry[] = [
      { type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: { status: 'active' } },
      { type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: null },
    ]

    expect(getLatestGoalState(branch)).toBeUndefined()
  })

  test('defines a finite continuation limit', () => {
    expect(GOAL_MAX_TURNS).toBe(50)
  })
})
