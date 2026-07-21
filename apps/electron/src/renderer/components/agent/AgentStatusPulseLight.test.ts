import { describe, expect, test } from 'bun:test'
import type { AgentStreamState, ToolActivity } from '@/atoms/agent-atoms'
import { buildAgentDelegationProgressSummary, buildAgentStatusTooltipModel, formatAgentStatusDuration } from './AgentStatusPulseLight'

function toolActivity(overrides: Partial<ToolActivity>): ToolActivity {
  return {
    toolUseId: overrides.toolUseId ?? 'tool-1',
    toolName: overrides.toolName ?? 'Read',
    input: overrides.input ?? {},
    done: overrides.done ?? false,
    ...overrides,
  }
}

function streamState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: true,
    content: '',
    toolActivities: [],
    startedAt: 1_000,
    ...overrides,
  }
}

describe('AgentStatusPulseLight tooltip model', () => {
  test('given running tool activity without higher-level progress when building tooltip then includes tool progress', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState({
        startedAt: 1_000,
        toolActivities: [
          toolActivity({ toolName: 'Bash', done: false }),
        ],
      }),
      now: 13_000,
    })

    expect(model.headline).toBe('执行中 · 12秒')
    expect(model.rows).toContainEqual({ label: '当前', value: '执行 Bash · 已完成 0/1 · 运行中 1' })
    expect(model.rows.some((row) => row.label === '工具')).toBe(false)
  })

  test('given mixed tool activities without higher-level progress when building tooltip then summarizes completed, running, and error counts', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState({
        toolActivities: [
          toolActivity({ toolUseId: 'tool-1', toolName: 'Read', done: true }),
          toolActivity({ toolUseId: 'tool-2', toolName: 'Bash', done: false }),
          toolActivity({ toolUseId: 'tool-3', toolName: 'Edit', done: true, isError: true }),
        ],
      }),
      now: 2_000,
    })

    expect(model.rows).toContainEqual({ label: '当前', value: '执行 Bash · 已完成 1/3 · 运行中 1 · 出错 1' })
    expect(model.rows.some((row) => row.label === '工具')).toBe(false)
  })

  test('given historical and current-run delegations when building summary then only current run is counted', () => {
    const summary = buildAgentDelegationProgressSummary([
      { createdAt: 1_000, delegationStatus: 'completed' },
      { createdAt: 2_000, delegationStatus: 'completed' },
      { createdAt: 3_000, delegationStatus: 'completed' },
      { createdAt: 20_000, delegationStatus: 'running' },
      { createdAt: 21_000, delegationStatus: 'running' },
    ], 19_000)

    expect(summary).toEqual({
      total: 2,
      completed: 0,
      running: 2,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
    })
  })

  test('given delegation dispatch tool before child sessions exist when building tooltip then shows dispatching state', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState({
        toolActivities: [
          toolActivity({ toolName: 'mcp__collaboration__delegate_agents', done: false }),
        ],
      }),
      now: 2_000,
    })

    expect(model.rows).toContainEqual({ label: '当前', value: '正在派发子任务' })
    expect(model.rows.some((row) => row.label === '子会话')).toBe(false)
  })

  test('given completed delegations while parent is running when building tooltip then shows result aggregation', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState(),
      delegationSummary: {
        total: 3,
        completed: 3,
        running: 0,
      },
      now: 2_000,
    })

    expect(model.rows).toContainEqual({ label: '当前', value: '正在汇总子任务结果' })
    expect(model.rows).toContainEqual({ label: '子会话', value: '已完成 3/3' })
  })

  test('given running delegations when building tooltip then shows child session progress', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState(),
      delegationSummary: {
        total: 3,
        completed: 1,
        running: 2,
      },
      now: 2_000,
    })

    expect(model.rows).toContainEqual({ label: '当前', value: '等待子任务结果' })
    expect(model.rows).toContainEqual({ label: '子会话', value: '已完成 1/3 · 运行中 2' })
  })

  test('given task progress when building tooltip then prioritizes current step over tool name', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState({
        toolActivities: [
          toolActivity({
            toolUseId: 'create-1',
            toolName: 'TaskCreate',
            done: true,
            input: { subject: '读取设计文档' },
            result: JSON.stringify({ task: { id: 'task-1', subject: '读取设计文档' } }),
          }),
          toolActivity({
            toolUseId: 'update-1',
            toolName: 'TaskUpdate',
            done: true,
            input: { taskId: 'task-1', status: 'completed' },
          }),
          toolActivity({
            toolUseId: 'create-2',
            toolName: 'TaskCreate',
            done: true,
            input: { subject: '重做 Hover 信息' },
            result: JSON.stringify({ task: { id: 'task-2', subject: '重做 Hover 信息' } }),
          }),
          toolActivity({
            toolUseId: 'update-2',
            toolName: 'TaskUpdate',
            done: true,
            input: { taskId: 'task-2', status: 'in_progress', activeForm: '设计 tooltip' },
          }),
          toolActivity({
            toolUseId: 'create-3',
            toolName: 'TaskCreate',
            done: true,
            input: { subject: '验证测试' },
            result: JSON.stringify({ task: { id: 'task-3', subject: '验证测试' } }),
          }),
        ],
      }),
      now: 2_000,
    })

    expect(model.rows).toContainEqual({ label: '当前', value: '设计 tooltip' })
    expect(model.rows).toContainEqual({ label: '进度', value: '已完成 1/3 · 当前第 2 步' })
    expect(model.rows.some((row) => row.label === '工具')).toBe(false)
  })

  test('given stream model when building tooltip then omits model because it is not progress information', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState({ model: 'deepseek-v4-pro' }),
      now: 2_000,
    })

    expect(model.rows.some((row) => row.label === '模型')).toBe(false)
    expect(model.ariaLabel).not.toContain('deepseek-v4-pro')
  })

  test('given retrying stream when building tooltip then includes retry attempt details', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'running',
      streamState: streamState({
        retrying: {
          currentAttempt: 6,
          maxAttempts: 25,
          history: [],
          failed: false,
        },
      }),
      now: 2_000,
    })

    expect(model.rows).toContainEqual({ label: '当前', value: '网络波动，自动恢复中' })
    expect(model.rows).toContainEqual({ label: '重试', value: '第 6/25 次' })
  })

  test('given error status when building tooltip then exposes error message as first row', () => {
    const model = buildAgentStatusTooltipModel({
      status: 'error',
      errorMessage: 'API 服务不可用',
      now: 2_000,
    })

    expect(model.headline).toBe('异常')
    expect(model.rows[0]).toEqual({ label: '错误', value: 'API 服务不可用' })
    expect(model.ariaLabel).toContain('错误：API 服务不可用')
  })

  test('formats duration for seconds, minutes, and hours', () => {
    expect(formatAgentStatusDuration(12_000)).toBe('12秒')
    expect(formatAgentStatusDuration(72_000)).toBe('1分12秒')
    expect(formatAgentStatusDuration(3_900_000)).toBe('1小时5分')
  })
})
