import { describe, expect, test } from 'bun:test'
import {
  isGoalStartCommand,
  waitForGoalCommandTurn,
  type PiSessionLifecycle,
} from './pi-command-lifecycle'

describe('Pi Goal command lifecycle', () => {
  test('recognizes goal starts but reserves exact stop command', () => {
    expect(isGoalStartCommand('/goal ship the feature')).toBe(true)
    expect(isGoalStartCommand('/goal stop procrastinating')).toBe(true)
    expect(isGoalStartCommand('/goal stop')).toBe(false)
    expect(isGoalStartCommand('/goal')).toBe(false)
  })

  test('waits for the nested goal turn after the command handler returns', async () => {
    let waited = false
    const session: PiSessionLifecycle = {
      isStreaming: true,
      pendingMessageCount: 0,
      waitForIdle: async () => {
        waited = true
      },
    }

    await waitForGoalCommandTurn(session, '/goal ship the feature')

    expect(waited).toBe(true)
  })

  test('does not wait for stop or ordinary prompts', async () => {
    let waited = false
    const session: PiSessionLifecycle = {
      isStreaming: true,
      pendingMessageCount: 1,
      waitForIdle: async () => {
        waited = true
      },
    }

    await waitForGoalCommandTurn(session, '/goal stop')
    await waitForGoalCommandTurn(session, 'continue the task')

    expect(waited).toBe(false)
  })
})
