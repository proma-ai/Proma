import { randomUUID } from 'node:crypto'
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

export const GOAL_STATE_ENTRY_TYPE = 'proma-goal-state'
export const GOAL_MAX_TURNS = 50

export type PromaGoalStatus = 'active' | 'completed' | 'stopped' | 'max_turns'

export interface PromaGoalState {
  id: string
  task: string
  status: PromaGoalStatus
  turnCount: number
  createdAt: string
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isGoalStatus(value: unknown): value is PromaGoalStatus {
  return value === 'active'
    || value === 'completed'
    || value === 'stopped'
    || value === 'max_turns'
}

function isPromaGoalState(value: unknown): value is PromaGoalState {
  if (!isRecord(value)) return false

  return typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.task === 'string'
    && value.task.length > 0
    && isGoalStatus(value.status)
    && typeof value.turnCount === 'number'
    && Number.isInteger(value.turnCount)
    && value.turnCount >= 0
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

export function getLatestGoalState(branch: readonly unknown[]): PromaGoalState | undefined {
  let latest: PromaGoalState | undefined

  for (const entry of branch) {
    if (!isRecord(entry)) continue
    if (entry.type !== 'custom' || entry.customType !== GOAL_STATE_ENTRY_TYPE) continue

    const data = entry.data
    if (isPromaGoalState(data)) latest = data
  }

  return latest
}

const GOAL_CONTEXT_TYPE = 'proma-goal-context'
const GOAL_STATUS_MESSAGE_TYPE = 'proma-goal-status'

function now(): string {
  return new Date().toISOString()
}

function createState(task: string): PromaGoalState {
  const timestamp = now()
  return {
    id: `goal-${randomUUID()}`,
    task,
    status: 'active',
    turnCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function withState(state: PromaGoalState, updates: Partial<PromaGoalState>): PromaGoalState {
  return { ...state, ...updates, updatedAt: now() }
}

function appendState(pi: ExtensionAPI, state: PromaGoalState): void {
  pi.appendEntry(GOAL_STATE_ENTRY_TYPE, state)
}

function notifyUsage(pi: ExtensionAPI, ctx: ExtensionContext, message: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, 'warning')
    return
  }

  pi.sendMessage({
    customType: GOAL_STATUS_MESSAGE_TYPE,
    content: message,
    display: true,
  })
}

function goalStartMessage(task: string): string {
  return [
    '[Proma Goal 开始]',
    `目标：${task}`,
    '请持续执行这个目标，不要只给计划。完成全部可验证工作后，必须调用 goal_complete，并在 summary 中说明完成证据。',
    '如果遇到无法安全解决的阻塞，请停止并明确说明阻塞原因，不要伪造完成。',
  ].join('\n')
}

function goalFollowUpMessage(task: string): string {
  return [
    '[Proma Goal 继续]',
    `目标：${task}`,
    '检查上一轮实际完成的工作，继续执行剩余任务。只有全部目标完成并有证据时才调用 goal_complete。',
  ].join('\n')
}

function goalContextMessage(state: PromaGoalState): string {
  return [
    '[Proma Goal 上下文]',
    `Goal ID：${state.id}`,
    `目标：${state.task}`,
    `当前续跑轮次：${state.turnCount}/${GOAL_MAX_TURNS}`,
    '完成条件：完成目标中的全部可验证工作，并调用 goal_complete(summary)。',
    '停止条件：用户输入 /goal stop、目标完成，或达到续跑上限。',
  ].join('\n')
}

function completeGoal(
  pi: ExtensionAPI,
  state: PromaGoalState | undefined,
  summary: string,
): AgentToolResult<PromaGoalState | null> {
  if (!state || state.status !== 'active') {
    return {
      content: [{ type: 'text', text: '当前没有活动 Goal，不能标记完成。' }],
      details: null,
    }
  }

  const completed = withState(state, { status: 'completed' })
  appendState(pi, completed)
  return {
    content: [{ type: 'text', text: `Goal 已完成：${summary}` }],
    details: completed,
  }
}

export function createPromaGoalExtension(): ExtensionFactory {
  return (pi) => {
    let goalState: PromaGoalState | undefined
    let continuationQueued = false

    const restoreState = (ctx: ExtensionContext): void => {
      goalState = getLatestGoalState(ctx.sessionManager.getBranch())
      continuationQueued = false
    }

    pi.on('session_start', (_event, ctx) => {
      restoreState(ctx)
    })

    pi.on('session_tree', (_event, ctx) => {
      restoreState(ctx)
    })

    pi.on('agent_start', () => {
      continuationQueued = false
    })

    pi.on('before_agent_start', () => {
      if (!goalState || goalState.status !== 'active') return

      return {
        message: {
          customType: GOAL_CONTEXT_TYPE,
          content: goalContextMessage(goalState),
          display: false,
        },
      }
    })

    pi.registerCommand('goal', {
      description: 'Start or stop a persistent Pi Goal',
      handler: async (args, ctx) => {
        const input = args.trim()
        if (!input) {
          notifyUsage(pi, ctx, '用法：/goal <任务> 或 /goal stop')
          return
        }

        if (input === 'stop') {
          if (goalState?.status === 'active') {
            goalState = withState(goalState, { status: 'stopped' })
            appendState(pi, goalState)
          }
          continuationQueued = false
          notifyUsage(pi, ctx, '当前 Goal 已停止。')
          return
        }

        if (input.startsWith('stop ')) {
          notifyUsage(pi, ctx, '用法：/goal <任务> 或 /goal stop')
          return
        }

        goalState = createState(input)
        continuationQueued = false
        appendState(pi, goalState)
        pi.sendUserMessage(goalStartMessage(input))
      },
    })

    pi.registerTool({
      name: 'goal_complete',
      label: 'Goal 完成',
      description: 'Mark the active Proma Goal as completed after verifying all requested work.',
      promptSnippet: 'Mark the active Proma Goal complete only after all work is verified.',
      parameters: Type.Object({
        summary: Type.String({ description: '简要说明完成的工作和验证证据' }),
      }),
      async execute(_toolCallId, params) {
        const result = completeGoal(pi, goalState, params.summary)
        if (result.details) {
          goalState = result.details
          continuationQueued = false
        }
        return result
      },
    })

    pi.on('agent_end', (_event: AgentEndEvent) => {
      if (!goalState || goalState.status !== 'active' || continuationQueued) return

      const nextTurnCount = goalState.turnCount + 1
      if (nextTurnCount >= GOAL_MAX_TURNS) {
        goalState = withState(goalState, { status: 'max_turns', turnCount: nextTurnCount })
        appendState(pi, goalState)
        pi.sendMessage({
          customType: GOAL_STATUS_MESSAGE_TYPE,
          content: `Goal 已达到 ${GOAL_MAX_TURNS} 轮安全上限，已停止自动续跑。请检查当前结果后重新发起 Goal。`,
          display: true,
        })
        return
      }

      goalState = withState(goalState, { turnCount: nextTurnCount })
      appendState(pi, goalState)
      continuationQueued = true
      pi.sendUserMessage(goalFollowUpMessage(goalState.task), { deliverAs: 'followUp' })
    })
  }
}
