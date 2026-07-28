import { describe, expect, test } from 'bun:test'
import { applyAgentEvent, clearAgentStreamError, isRetryEventForCurrentStream, type AgentStreamState } from './agent-atoms'

function createStreamState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: true,
    content: '',
    toolActivities: [],
    inputTokens: 180_000,
    outputTokens: 2_000,
    cacheReadTokens: 160_000,
    cacheCreationTokens: 18_000,
    contextWindow: 200_000,
    ...overrides,
  }
}

describe('Agent 上下文压缩状态', () => {
  test('given Pi 手动压缩提供预估 token when 压缩完成 then 显示预估值并清除旧明细', () => {
    const result = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })

    expect(result).toMatchObject({
      isCompacting: false,
      inputTokens: 32_000,
      contextWindow: 200_000,
      contextUsageIsEstimated: true,
    })
    expect(result.outputTokens).toBeUndefined()
    expect(result.cacheReadTokens).toBeUndefined()
    expect(result.cacheCreationTokens).toBeUndefined()
  })

  test('given 压缩后的预估值 when 当前压缩操作的收尾 result 没有 usage then 保留预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, { type: 'complete' })

    expect(result).toMatchObject({
      inputTokens: 32_000,
      contextUsageIsEstimated: true,
    })
  })

  test('given 压缩后的预估值 when 收到零 token result then 保留预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, {
      type: 'complete',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    })

    expect(result).toMatchObject({
      inputTokens: 32_000,
      contextUsageIsEstimated: true,
    })
  })

  test('given 压缩后的预估值 when 下一轮收到真实 usage then 用真实值覆盖预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, {
      type: 'usage_update',
      usage: {
        inputTokens: 36_000,
        cacheReadTokens: 30_000,
        outputTokens: 800,
      },
    })

    expect(result).toMatchObject({
      inputTokens: 36_000,
      cacheReadTokens: 30_000,
      outputTokens: 800,
      contextUsageIsEstimated: false,
    })
  })

  test('given 压缩后的预估值 when 下一轮仅在 result 返回 usage then 用真实值覆盖预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, {
      type: 'complete',
      usage: {
        inputTokens: 40_000,
        cacheReadTokens: 34_000,
      },
    })

    expect(result).toMatchObject({
      inputTokens: 40_000,
      cacheReadTokens: 34_000,
      contextUsageIsEstimated: false,
    })
  })

  test('given 没有 Pi 预估 token 的压缩完成事件 when 处理 then 保持既有上下文用量', () => {
    const result = applyAgentEvent(createStreamState(), { type: 'compact_complete', status: 'success' })

    expect(result).toMatchObject({
      isCompacting: false,
      inputTokens: 180_000,
    })
    expect(result.contextUsageIsEstimated).toBeUndefined()
  })

  test('given 压缩成功 when 同一流开始下一项工具工作 then 清除压缩终态并恢复正常进度', () => {
    const compacting = applyAgentEvent(createStreamState(), { type: 'compacting' })
    const compacted = applyAgentEvent(compacting, { type: 'compact_complete', status: 'success' })
    const resumed = applyAgentEvent(compacted, {
      type: 'tool_start',
      toolName: 'TaskCreate',
      toolUseId: 'resume-task',
      input: {},
    })

    expect(compacted).toMatchObject({
      isCompacting: false,
      compactInFlight: true,
      contextCompaction: { status: 'success' },
    })
    expect(resumed.contextCompaction).toBeUndefined()
    expect(resumed.compactInFlight).toBe(false)
    expect(resumed.toolActivities).toContainEqual(expect.objectContaining({
      toolUseId: 'resume-task',
      done: false,
    }))
  })

  test('given 压缩成功 when 当前流直接结束 then 保留终态反馈给短时完成提示', () => {
    const compacting = applyAgentEvent(createStreamState(), { type: 'compacting' })
    const compacted = applyAgentEvent(compacting, { type: 'compact_complete', status: 'success' })
    const result = applyAgentEvent(compacted, { type: 'complete' })

    expect(result).toMatchObject({
      compactInFlight: true,
      contextCompaction: { status: 'success' },
    })
  })
})

describe('Agent retry 状态机', () => {
  const runStartedAt = 1_000
  const retryAttempt = {
    attempt: 8,
    totalAttempt: 8,
    maxTotalAttempts: 8,
    timestamp: 2_000,
    reason: 'TypeError: Failed to fetch',
    errorMessage: 'TypeError: Failed to fetch',
    delaySeconds: 128,
  }

  test('given retry 已安排 when 实际请求尚未开始 then 不把它记入执行历史', () => {
    const scheduled = applyAgentEvent(createStreamState({ startedAt: runStartedAt }), {
      type: 'retrying',
      attempt: 8,
      maxAttempts: 8,
      totalAttempt: 8,
      maxTotalAttempts: 8,
      runStartedAt,
      scheduledAt: 1_500,
      delaySeconds: 128,
      reason: 'TypeError: Failed to fetch',
    })

    expect(scheduled.retrying).toMatchObject({
      phase: 'scheduled',
      currentAttempt: 8,
      maxAttempts: 8,
      history: [],
    })
  })

  test('given 第 8 次 retry 已实际开始且最终耗尽 when 更新终态 then 历史不重复追加第 8 项', () => {
    const started = applyAgentEvent(createStreamState({ startedAt: runStartedAt }), {
      type: 'retry_attempt',
      attemptData: retryAttempt,
      runStartedAt,
      maxAttempts: 8,
      totalAttempt: 8,
      maxTotalAttempts: 8,
    })
    const exhausted = applyAgentEvent(started, {
      type: 'retry_failed',
      finalAttempt: { ...retryAttempt, errorMessage: '最终请求仍然失败', reason: '最终请求仍然失败' },
      runStartedAt,
      maxAttempts: 8,
      totalAttempt: 8,
      maxTotalAttempts: 8,
    })

    expect(exhausted.retrying).toMatchObject({ phase: 'exhausted', currentAttempt: 8 })
    expect(exhausted.retrying?.history).toHaveLength(1)
    expect(exhausted.retrying?.history[0]).toMatchObject({ attempt: 8, timestamp: 2_000, reason: '最终请求仍然失败' })
  })

  test('given retry 成功 when 后续输出到达 then 成功状态被自然收起', () => {
    const running = applyAgentEvent(createStreamState({ startedAt: runStartedAt }), {
      type: 'retry_attempt',
      attemptData: retryAttempt,
      runStartedAt,
      maxAttempts: 8,
    })
    const succeeded = applyAgentEvent(running, {
      type: 'retry_cleared',
      runStartedAt,
      attempt: 8,
      maxAttempts: 8,
    })

    expect(succeeded.retrying?.phase).toBe('succeeded')
    expect(applyAgentEvent(succeeded, { type: 'text_delta', text: '已恢复' }).retrying).toBeUndefined()
  })

  test('given 旧 run 的 retry 终态 when 新流已经开始 then 忽略迟到事件', () => {
    const current = createStreamState({ startedAt: runStartedAt + 1 })
    expect(applyAgentEvent(current, {
      type: 'retry_cancelled',
      runStartedAt,
      attempt: 1,
      maxAttempts: 8,
      reason: 'Retry cancelled',
    })).toBe(current)
  })

  test('given 带 run 标识的 retry 事件 when 流式状态缺少同一 startedAt then 严格拒绝它', () => {
    expect(isRetryEventForCurrentStream(createStreamState(), { runStartedAt })).toBe(false)
  })

  test('given retry 终态或错误 when STREAM_COMPLETE 尚未到达 then 不提前释放运行锁', () => {
    const exhausted = applyAgentEvent(createStreamState({ startedAt: runStartedAt }), {
      type: 'retry_failed',
      finalAttempt: retryAttempt,
      runStartedAt,
      maxAttempts: 8,
    })
    const cancelled = applyAgentEvent(createStreamState({ startedAt: runStartedAt }), {
      type: 'retry_cancelled',
      runStartedAt,
      attempt: 1,
      maxAttempts: 8,
      reason: 'Retry cancelled',
    })

    expect(exhausted.running).toBe(true)
    expect(cancelled.running).toBe(true)
    expect(applyAgentEvent(createStreamState(), { type: 'error', message: '终态错误' }).running).toBe(true)
  })
})

describe('Agent 流式错误状态', () => {
  test('given Pi 原生重试成功 when 清理会话错误 then 仅移除该会话的过期记录', () => {
    const errors = new Map([
      ['retried-session', '服务繁忙'],
      ['failed-session', '认证失败'],
    ])

    expect(clearAgentStreamError(errors, 'retried-session')).toEqual(new Map([
      ['failed-session', '认证失败'],
    ]))
  })

  test('given 当前会话没有流式错误 when 清理 then 保持原 Map 引用', () => {
    const errors = new Map([['failed-session', '认证失败']])

    expect(clearAgentStreamError(errors, 'retried-session')).toBe(errors)
  })
})
