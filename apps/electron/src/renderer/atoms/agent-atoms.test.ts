import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AskUserRequest, ExitPlanModeRequest, PermissionRequest } from '@proma/shared'
import {
  agentSessionIndicatorMapAtom,
  agentStreamErrorsAtom,
  agentStreamingStatesAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
  allPendingPermissionRequestsAtom,
  unviewedCompletedSessionIdsAtom,
  type AgentStreamState,
} from './agent-atoms'

function runningState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: true,
    content: '',
    toolActivities: [],
    startedAt: 1_000,
    ...overrides,
  }
}

function permissionRequest(sessionId: string): PermissionRequest {
  return {
    requestId: `perm-${sessionId}`,
    sessionId,
    toolName: 'Bash',
    toolInput: { command: 'bun test' },
    description: '运行测试',
    dangerLevel: 'normal',
  }
}

function askUserRequest(sessionId: string): AskUserRequest {
  return {
    requestId: `ask-${sessionId}`,
    sessionId,
    questions: [{ question: '继续吗？', options: [] }],
    toolInput: {},
  }
}

function exitPlanRequest(sessionId: string): ExitPlanModeRequest {
  return {
    requestId: `plan-${sessionId}`,
    sessionId,
    toolInput: {},
    allowedPrompts: [],
  }
}

describe('agentSessionIndicatorMapAtom', () => {
  test('given no session state when deriving indicators then idle sessions are omitted', () => {
    const store = createStore()

    expect(store.get(agentSessionIndicatorMapAtom).has('idle-session')).toBe(false)
  })

  test('given running stream state when deriving indicators then session is running', () => {
    const store = createStore()
    store.set(agentStreamingStatesAtom, new Map([
      ['session-running', runningState()],
    ]))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-running')).toBe('running')
  })

  test('given unviewed completed session when deriving indicators then session is completed', () => {
    const store = createStore()
    store.set(unviewedCompletedSessionIdsAtom, new Set(['session-completed']))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-completed')).toBe('completed')
  })

  test('given stream error without running state when deriving indicators then session is error', () => {
    const store = createStore()
    store.set(agentStreamErrorsAtom, new Map([
      ['session-error', 'API 服务不可用'],
    ]))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-error')).toBe('error')
  })

  test('given running stream and stream error when deriving indicators then error overrides running', () => {
    const store = createStore()
    store.set(agentStreamingStatesAtom, new Map([
      ['session-error', runningState()],
    ]))
    store.set(agentStreamErrorsAtom, new Map([
      ['session-error', '网络已断开'],
    ]))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-error')).toBe('error')
  })

  test('given completed session and stream error when deriving indicators then error overrides completed', () => {
    const store = createStore()
    store.set(unviewedCompletedSessionIdsAtom, new Set(['session-error']))
    store.set(agentStreamErrorsAtom, new Map([
      ['session-error', '重试失败'],
    ]))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-error')).toBe('error')
  })

  test('given pending permission request when deriving indicators then blocked overrides error and running', () => {
    const store = createStore()
    store.set(agentStreamingStatesAtom, new Map([
      ['session-blocked', runningState()],
    ]))
    store.set(agentStreamErrorsAtom, new Map([
      ['session-blocked', '旧错误不应盖过待审批'],
    ]))
    store.set(allPendingPermissionRequestsAtom, new Map([
      ['session-blocked', [permissionRequest('session-blocked')]],
    ]))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-blocked')).toBe('blocked')
  })

  test('given pending AskUser request when deriving indicators then session is blocked', () => {
    const store = createStore()
    store.set(agentStreamingStatesAtom, new Map([
      ['session-ask', runningState()],
    ]))
    store.set(allPendingAskUserRequestsAtom, new Map([
      ['session-ask', [askUserRequest('session-ask')]],
    ]))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-ask')).toBe('blocked')
  })

  test('given pending ExitPlan request when deriving indicators then session is blocked', () => {
    const store = createStore()
    store.set(agentStreamingStatesAtom, new Map([
      ['session-plan', runningState()],
    ]))
    store.set(allPendingExitPlanRequestsAtom, new Map([
      ['session-plan', [exitPlanRequest('session-plan')]],
    ]))

    expect(store.get(agentSessionIndicatorMapAtom).get('session-plan')).toBe('blocked')
  })
})
