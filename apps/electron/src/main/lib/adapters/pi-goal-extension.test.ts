import { describe, expect, test } from 'bun:test'
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import {
  GOAL_MAX_TURNS,
  GOAL_STATE_ENTRY_TYPE,
  createPromaGoalExtension,
  getLatestGoalState,
  type PromaGoalState,
} from './pi-goal-extension'

interface GoalBranchEntry {
  type: 'custom'
  customType: string
  data: unknown
}

interface SentUserMessage {
  content: string
  options?: { deliverAs?: 'steer' | 'followUp' }
}

interface SentMessage {
  message: { customType: string; content: string; display: boolean }
  options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'followUp' | 'nextTurn' }
}

interface GoalHarness {
  branch: unknown[]
  commands: Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }>
  tools: Map<string, ToolDefinition>
  handlers: Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown>
  appended: Array<{ customType: string; data: unknown }>
  sentUserMessages: SentUserMessage[]
  sentMessages: SentMessage[]
  notifications: string[]
  context: ExtensionContext
}

function createHarness(): GoalHarness {
  const harness = {
    branch: [],
    commands: new Map(),
    tools: new Map(),
    handlers: new Map(),
    appended: [],
    sentUserMessages: [],
    sentMessages: [],
    notifications: [],
  } as Omit<GoalHarness, 'context'>

  const context = {
    hasUI: false,
    isIdle: () => true,
    sessionManager: {
      getBranch: () => harness.branch,
    },
    ui: {
      notify: (message: string) => harness.notifications.push(message),
    },
  } as unknown as ExtensionContext

  const api = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown) => {
      harness.handlers.set(event, handler)
    },
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }) => {
      harness.commands.set(name, options)
    },
    registerTool: (tool: ToolDefinition) => {
      harness.tools.set(tool.name, tool)
    },
    appendEntry: (customType: string, data: unknown) => {
      harness.appended.push({ customType, data })
      harness.branch.push({ type: 'custom', customType, data })
    },
    sendUserMessage: (content: string, options?: SentUserMessage['options']) => {
      harness.sentUserMessages.push({ content, options })
    },
    sendMessage: (
      message: SentMessage['message'],
      options?: SentMessage['options'],
    ) => {
      harness.sentMessages.push({ message, options })
    },
  } as unknown as ExtensionAPI

  createPromaGoalExtension()(api)

  return { ...harness, context }
}

function getHandler(harness: GoalHarness, event: string) {
  const handler = harness.handlers.get(event)
  if (!handler) throw new Error(`Missing handler: ${event}`)
  return handler
}

function getState(harness: GoalHarness): PromaGoalState | undefined {
  return getLatestGoalState(harness.branch)
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

describe('Proma goal extension', () => {
  test('/goal <task> creates an active goal and triggers the initial turn', async () => {
    const harness = createHarness()
    const command = harness.commands.get('goal')
    if (!command) throw new Error('Missing /goal command')

    await command.handler('ship the feature', harness.context)

    expect(getState(harness)).toMatchObject({ task: 'ship the feature', status: 'active', turnCount: 0 })
    expect(harness.appended.at(-1)?.customType).toBe(GOAL_STATE_ENTRY_TYPE)
    expect(harness.sentUserMessages).toHaveLength(1)
    expect(harness.sentUserMessages[0]?.content).toContain('ship the feature')
  })

  test('accepts a task that starts with the word stop', async () => {
    const harness = createHarness()
    const command = harness.commands.get('goal')
    if (!command) throw new Error('Missing /goal command')

    await command.handler('stop procrastinating', harness.context)

    expect(getState(harness)).toMatchObject({ task: 'stop procrastinating', status: 'active' })
    expect(harness.sentUserMessages).toHaveLength(1)
  })

  test('/goal stop is idempotent and prevents follow-up turns', async () => {
    const harness = createHarness()
    const command = harness.commands.get('goal')
    if (!command) throw new Error('Missing /goal command')

    await command.handler('ship the feature', harness.context)
    await command.handler('stop', harness.context)
    await command.handler('stop', harness.context)

    expect(getState(harness)?.status).toBe('stopped')
    expect(harness.sentUserMessages).toHaveLength(1)
    expect(harness.notifications).toHaveLength(0)
    expect(harness.sentMessages).toHaveLength(2)
  })

  test('goal_complete marks the active goal completed', async () => {
    const harness = createHarness()
    const command = harness.commands.get('goal')
    const tool = harness.tools.get('goal_complete')
    if (!command || !tool) throw new Error('Missing goal command or tool')

    await command.handler('ship the feature', harness.context)
    await tool.execute(
      'tool-1',
      { summary: 'verified the feature' } as never,
      undefined,
      undefined,
      harness.context,
    )

    expect(getState(harness)?.status).toBe('completed')
  })

  test('before_agent_start injects the active goal context', async () => {
    const harness = createHarness()
    const command = harness.commands.get('goal')
    if (!command) throw new Error('Missing /goal command')

    await command.handler('ship the feature', harness.context)
    const result = await getHandler(harness, 'before_agent_start')({}, harness.context) as {
      message?: { content?: string; display?: boolean }
    }

    expect(result.message?.content).toContain('ship the feature')
    expect(result.message?.display).toBe(false)
  })

  test('before_agent_start lazily restores a goal when the host does not emit session_start', async () => {
    const harness = createHarness()
    const state: PromaGoalState = {
      id: 'goal-1',
      task: 'resume the feature',
      status: 'active',
      turnCount: 3,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }
    harness.branch.push({ type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: state })

    const result = await getHandler(harness, 'before_agent_start')({}, harness.context) as {
      message?: { content?: string; display?: boolean }
    }

    expect(result.message?.content).toContain('resume the feature')
    expect(result.message?.display).toBe(false)
  })

  test('agent_end queues follow-up only for an active goal below the limit', async () => {
    const harness = createHarness()
    const command = harness.commands.get('goal')
    if (!command) throw new Error('Missing /goal command')

    await command.handler('ship the feature', harness.context)
    await getHandler(harness, 'agent_end')({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [], stopReason: 'stop' }],
    } as unknown as AgentEndEvent, harness.context)

    expect(getState(harness)).toMatchObject({ status: 'active', turnCount: 1 })
    expect(harness.sentUserMessages).toHaveLength(2)
    expect(harness.sentUserMessages[1]?.options).toEqual({ deliverAs: 'followUp' })
  })

  test.each(['aborted', 'error'] as const)('does not continue after an %s assistant ending', async (stopReason) => {
    const harness = createHarness()
    const command = harness.commands.get('goal')
    if (!command) throw new Error('Missing /goal command')

    await command.handler('ship the feature', harness.context)
    await getHandler(harness, 'agent_end')({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [], stopReason }],
    } as unknown as AgentEndEvent, harness.context)

    expect(getState(harness)).toMatchObject({ status: 'active', turnCount: 0 })
    expect(harness.sentUserMessages).toHaveLength(1)
  })

  test('the limit transitions an active goal to max_turns without queuing another turn', async () => {
    const harness = createHarness()
    const state: PromaGoalState = {
      id: 'goal-1',
      task: 'ship the feature',
      status: 'active',
      turnCount: GOAL_MAX_TURNS - 1,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }
    harness.branch.push({ type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: state })
    await getHandler(harness, 'session_start')({}, harness.context)
    await getHandler(harness, 'agent_end')({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [], stopReason: 'stop' }],
    } as unknown as AgentEndEvent, harness.context)

    expect(getState(harness)).toMatchObject({ status: 'max_turns', turnCount: GOAL_MAX_TURNS })
    expect(harness.sentUserMessages).toHaveLength(0)
    expect(harness.sentMessages).toHaveLength(1)
  })
})
