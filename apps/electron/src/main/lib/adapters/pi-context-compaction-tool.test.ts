import { describe, expect, test } from 'bun:test'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import {
  buildCurrentSessionCompactionTool,
  canRunCurrentSessionCompaction,
  compactCurrentSessionAfterTurn,
} from './pi-agent-adapter'

function createToolSdk() {
  return {
    defineTool<T>(tool: T): T {
      return tool
    },
  } as unknown as typeof import('@earendil-works/pi-coding-agent')
}

describe('Pi current-session context compaction tool', () => {
  test('schedules compaction and terminates the calling turn', async () => {
    let requests = 0
    const tool = buildCurrentSessionCompactionTool(createToolSdk(), () => { requests += 1 }, undefined)

    const result = await tool.execute('tool-call-1', {}, undefined, undefined, undefined as never)

    expect(tool.name).toBe('CompactContext')
    expect(requests).toBe(1)
    expect(result.terminate).toBe(true)
    expect(result.details).toEqual(expect.objectContaining({ status: 'scheduled' }))
  })

  test('only permits compaction as the sole tool in its batch', () => {
    expect(canRunCurrentSessionCompaction(['CompactContext'])).toBe(true)
    expect(canRunCurrentSessionCompaction(['Write', 'CompactContext'])).toBe(false)
    expect(canRunCurrentSessionCompaction(['CompactContext', 'Write'])).toBe(false)
  })

  test('keeps compaction requests scoped to their own tool instances', async () => {
    let firstRequests = 0
    let secondRequests = 0
    const first = buildCurrentSessionCompactionTool(createToolSdk(), () => { firstRequests += 1 }, undefined)
    const second = buildCurrentSessionCompactionTool(createToolSdk(), () => { secondRequests += 1 }, undefined)

    await first.execute('tool-call-1', {}, undefined, undefined, undefined as never)

    expect(firstRequests).toBe(1)
    expect(secondRequests).toBe(0)
  })

  test('compacts the supplied session after the tool turn settles', async () => {
    let compactCalls = 0
    const session = {
      sessionId: 'current-session',
      compact: async () => ({ summary: String(++compactCalls), firstKeptEntryId: 'entry-1', tokensBefore: 100 }),
    } as unknown as Pick<AgentSession, 'compact' | 'sessionId'>

    await expect(compactCurrentSessionAfterTurn(session, () => {})).resolves.toBe('compacted')
    expect(compactCalls).toBe(1)
  })

  test('reports no-op compaction without failing the session', async () => {
    const messages: unknown[] = []
    const session = {
      sessionId: 'current-session',
      compact: async () => { throw new Error('Nothing to compact (session too small)') },
    } as unknown as Pick<AgentSession, 'compact' | 'sessionId'>

    await expect(compactCurrentSessionAfterTurn(session, (message) => messages.push(message))).resolves.toBe('noop')
    expect(messages).toEqual([expect.objectContaining({ subtype: 'status', compact_result: 'noop', session_id: 'current-session' })])
  })

  test('surfaces unexpected compaction failures', async () => {
    const session = {
      sessionId: 'current-session',
      compact: async () => { throw new Error('provider unavailable') },
    } as unknown as Pick<AgentSession, 'compact' | 'sessionId'>

    await expect(compactCurrentSessionAfterTurn(session, () => {})).rejects.toThrow('provider unavailable')
  })
})
