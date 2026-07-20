import { describe, expect, test } from 'bun:test'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { aggregateTaskItems, isTerminalTaskStatus } from './task-progress'

function activity(toolName: string, input: Record<string, unknown>, result?: string): ToolActivity {
  return {
    toolUseId: `${toolName}-${Math.random()}`,
    toolName,
    input,
    result,
    done: true,
  }
}

describe('任务进度聚合', () => {
  test('given Pi and Claude compatible statuses when aggregating then preserves terminal and blocked states', () => {
    const activities = [
      activity('TodoWrite', {
        todos: [
          { subject: '完成项', status: 'completed' },
          { subject: '阻塞项', status: 'blocked' },
          { subject: '取消项', status: 'cancelled' },
          { subject: '失败项', status: 'error' },
        ],
      }),
    ]

    const items = aggregateTaskItems(activities, false)
    expect(items.map((item) => item.status)).toEqual(['completed', 'blocked', 'cancelled', 'error'])
    expect(isTerminalTaskStatus('completed')).toBe(true)
    expect(isTerminalTaskStatus('cancelled')).toBe(true)
    expect(isTerminalTaskStatus('error')).toBe(true)
    expect(isTerminalTaskStatus('blocked')).toBe(false)
  })

  test('given a TaskCreate tool result and update when aggregating then links the SDK task id', () => {
    const activities = [
      activity('TaskCreate', { subject: '检查实现' }, JSON.stringify({ task: { id: '42', subject: '检查实现' } })),
      activity('TaskUpdate', { taskId: '42', status: 'in_progress', activeForm: '正在检查实现' }),
    ]

    expect(aggregateTaskItems(activities, false)).toEqual([
      { id: '42', subject: '检查实现', status: 'in_progress', activeForm: '正在检查实现' },
    ])
  })

  test('given an update without a current-turn create when aggregating without history then does not recover a prior turn subject', () => {
    const activities = [activity('TaskUpdate', { taskId: 'prior-task', status: 'in_progress' })]

    expect(aggregateTaskItems(activities, false)).toEqual([
      { id: 'prior-task', subject: '任务 #prior-task', status: 'in_progress', activeForm: undefined },
    ])
    expect(aggregateTaskItems(activities, false, new Map([['prior-task', '历史任务']]))).toEqual([
      { id: 'prior-task', subject: '历史任务', status: 'in_progress', activeForm: undefined },
    ])
  })
})
