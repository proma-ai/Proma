import { atom } from 'jotai'
import type { SlackBotBridgeState, SlackBridgeState } from '@proma/shared'

/** Slack Bot 状态（botId → 连接状态）。 */
export const slackBotStatesAtom = atom<Record<string, SlackBotBridgeState>>({})

export const slackAnyConnectedAtom = atom((get) =>
  Object.values(get(slackBotStatesAtom)).some((state) => state.status === 'connected'),
)

export const slackBridgeStateAtom = atom<SlackBridgeState>((get) => {
  const first = Object.values(get(slackBotStatesAtom))[0]
  return first ?? { status: 'disconnected', activeBindings: 0, queuedRuns: 0 }
})
