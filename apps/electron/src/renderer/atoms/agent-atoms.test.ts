import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import {
  agentSessionInputStreamStateAtomFamily,
  agentSessionStreamingStateAtomFamily,
  agentStreamingStatesAtom,
  applyAgentEvent,
  clearAgentStreamError,
  getDelegationTabLabel,
  isRetryEventForCurrentStream,
  isWorkspaceComponentTab,
  sanitizeWorkspaceComponentTabs,
  agentSessionComponentTabsAtomFamily,
  agentDiffPanelTabAtom,
  agentSidePanelOpenAtomFamily,
  revealChangedWorkspaceComponentAtom,
  type AgentStreamState,
} from './agent-atoms'

function createStreamState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: true,
    inputTokens: 180_000,
    outputTokens: 2_000,
    cacheReadTokens: 160_000,
    cacheCreationTokens: 18_000,
    contextWindow: 200_000,
    ...overrides,
  }
}

describe('右侧工作区组件', () => {
  test('工作区组件 Tab 按 session 隔离，不会影响同一 workspace 的其他会话', () => {
    const store = createStore()
    const sourceSessionTabs = agentSessionComponentTabsAtomFamily('session-a')

    store.set(sourceSessionTabs, ['skills', 'memory'])

    expect(store.get(sourceSessionTabs)).toEqual(['skills', 'memory'])
    expect(store.get(agentSessionComponentTabsAtomFamily('session-b'))).toEqual([])
  })

  test('Agent 变更只打开来源 session 的对应 Tab', () => {
    const store = createStore()

    store.set(revealChangedWorkspaceComponentAtom, { sessionId: 'source-session', component: 'memory' })

    expect(store.get(agentSessionComponentTabsAtomFamily('source-session'))).toEqual(['memory'])
    expect(store.get(agentSessionComponentTabsAtomFamily('other-session'))).toEqual([])
    expect(store.get(agentSidePanelOpenAtomFamily('source-session'))).toBe(true)
    expect(store.get(agentDiffPanelTabAtom).get('source-session')).toBe('memory')
    expect(store.get(agentDiffPanelTabAtom).get('other-session')).toBeUndefined()
  })

  test('只接受已注册的项目级组件类型', () => {
    expect(isWorkspaceComponentTab('todos')).toBe(true)
    expect(isWorkspaceComponentTab('memory')).toBe(true)
    expect(isWorkspaceComponentTab('browser:tab-1')).toBe(false)
    expect(isWorkspaceComponentTab('files')).toBe(false)
  })

  test('过滤旧版本或异常持久化的项目级 Tab', () => {
    expect(sanitizeWorkspaceComponentTabs(['todos', '', 'legacy-memory', 'memory'])).toEqual(['todos', 'memory'])
  })

  test('委派子 Agent 标题为空时使用可见的默认 Tab 标签', () => {
    expect(getDelegationTabLabel('  ')).toBe('委派任务')
    expect(getDelegationTabLabel(undefined)).toBe('委派任务')
    expect(getDelegationTabLabel('整理 PR')).toBe('整理 PR')
  })
})

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
    expect('toolActivities' in resumed).toBe(false)
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

  test('given retry 成功 when 后续工具调用到达 then 成功状态被自然收起', () => {
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
    expect(applyAgentEvent(succeeded, {
      type: 'tool_start',
      toolName: 'Read',
      toolUseId: 'resume-read',
      input: {},
    }).retrying).toBeUndefined()
  })

  test('given legacy text delta when the runtime reducer receives it then it does not duplicate the live transcript', () => {
    const state = createStreamState()

    expect(applyAgentEvent(state, { type: 'text_delta', text: '只由 live SDKMessage 渲染' })).toBe(state)
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

describe('Agent per-session 流式状态 family', () => {
  test('given another session changes when the active family is subscribed then it does not notify', () => {
    const store = createStore()
    const activeAtom = agentSessionStreamingStateAtomFamily('active-session')
    const otherAtom = agentSessionStreamingStateAtomFamily('other-session')
    const activeState = createStreamState()
    const otherState = createStreamState({ inputTokens: 20_000 })

    store.set(activeAtom, activeState)
    store.set(otherAtom, otherState)
    store.get(activeAtom)

    let notifications = 0
    const unsubscribe = store.sub(activeAtom, () => {
      notifications += 1
    })

    store.set(otherAtom, { ...otherState, inputTokens: 21_000 })

    expect(notifications).toBe(0)
    expect(store.get(agentStreamingStatesAtom).get('active-session')).toBe(activeState)
    expect(store.get(agentStreamingStatesAtom).get('other-session')?.inputTokens).toBe(21_000)
    unsubscribe()
  })

  test('given a session family update when the aggregate compatibility atom is read then it reflects the same state reference', () => {
    const store = createStore()
    const state = createStreamState({ running: true })
    store.set(agentSessionStreamingStateAtomFamily('active-session'), state)

    expect(store.get(agentStreamingStatesAtom)).toEqual(new Map([['active-session', state]]))
  })
})


describe('Agent 输入流状态订阅隔离', () => {
  test('given usage changes in the active session when the input selector is subscribed then it does not notify', () => {
    const store = createStore()
    const inputStateAtom = agentSessionInputStreamStateAtomFamily('active-session')
    const runningState = createStreamState({ inputTokens: 10_000 })
    store.set(agentStreamingStatesAtom, new Map([['active-session', runningState]]))
    store.get(inputStateAtom)

    let notifications = 0
    const unsubscribe = store.sub(inputStateAtom, () => {
      notifications += 1
    })

    store.set(agentStreamingStatesAtom, new Map([[
      'active-session',
      { ...runningState, inputTokens: 12_000, outputTokens: 900 },
    ]]))

    expect(notifications).toBe(0)
    unsubscribe()
  })

  test('given another session changes when the input selector is subscribed then it does not notify', () => {
    const store = createStore()
    const inputStateAtom = agentSessionInputStreamStateAtomFamily('active-session')
    const activeState = createStreamState()
    const otherState = createStreamState({ inputTokens: 20_000 })
    store.set(agentStreamingStatesAtom, new Map([
      ['active-session', activeState],
      ['other-session', otherState],
    ]))
    store.get(inputStateAtom)

    let notifications = 0
    const unsubscribe = store.sub(inputStateAtom, () => {
      notifications += 1
    })

    store.set(agentStreamingStatesAtom, new Map([
      ['active-session', activeState],
      ['other-session', { ...otherState, inputTokens: 21_000 }],
    ]))

    expect(notifications).toBe(0)
    unsubscribe()
  })
})
