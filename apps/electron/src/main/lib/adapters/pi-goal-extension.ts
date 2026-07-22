import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

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

interface GoalStateEntry {
  type: 'custom'
  customType: string
  data: unknown
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

    const data = (entry as GoalStateEntry).data
    if (isPromaGoalState(data)) latest = data
  }

  return latest
}

export const createPromaGoalExtension: () => ExtensionFactory = () => {
  throw new Error('Proma Goal extension is not implemented yet')
}
