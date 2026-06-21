import { describe, test, expect } from 'bun:test'
import { ArtifactPartialStreamTracker } from './artifact-partial-stream'
import type { SDKMessage, PromaEvent } from '@proma/shared'

type ArtifactStreamEvent = Extract<PromaEvent, { type: 'artifact_stream' }>
type ArtifactStreamEndEvent = Extract<PromaEvent, { type: 'artifact_stream_end' }>

function asStreamEvent(e: PromaEvent): ArtifactStreamEvent {
  return e as ArtifactStreamEvent
}
function asStreamEndEvent(e: PromaEvent): ArtifactStreamEndEvent {
  return e as ArtifactStreamEndEvent
}

function makeStreamEvent(event: Record<string, unknown>, parentToolUseId?: string | null): SDKMessage {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: parentToolUseId ?? null,
  } as unknown as SDKMessage
}

function makeAssistantMessage(blocks: Record<string, unknown>[]): SDKMessage {
  return {
    type: 'assistant',
    message: { content: blocks },
  } as unknown as SDKMessage
}

describe('ArtifactPartialStreamTracker', () => {
  test('ignores non-stream_event messages', () => {
    const tracker = new ArtifactPartialStreamTracker()
    const events = tracker.handleMessage({ type: 'user', message: {} } as unknown as SDKMessage)
    expect(events).toEqual([])
  })

  test('tracks create_artifact content_block_start and deltas', () => {
    const tracker = new ArtifactPartialStreamTracker()

    const start = makeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_001',
        name: 'create_artifact',
      },
    })
    expect(tracker.handleMessage(start)).toEqual([])

    const delta = makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"title":' },
    })
    const events = tracker.handleMessage(delta)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('artifact_stream')
    expect(asStreamEvent(events[0]!).toolUseId).toBe('toolu_001')
    expect(asStreamEvent(events[0]!).partialJson).toBe('{"title":')
  })

  test('tracks edit_artifact blocks', () => {
    const tracker = new ArtifactPartialStreamTracker()

    const start = makeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_002',
        name: 'edit_artifact',
      },
    })
    expect(tracker.handleMessage(start)).toEqual([])

    const delta = makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"artifact_id":"art-001"}' },
    })
    const events = tracker.handleMessage(delta)
    expect(events).toHaveLength(1)
    expect(asStreamEvent(events[0]!).toolName).toBe('edit_artifact')
  })

  test('recognizes MCP-qualified artifact tool names', () => {
    const tracker = new ArtifactPartialStreamTracker()

    const start = makeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'mcp_tool_use',
        id: 'toolu_003',
        name: 'create_artifact',
        server_name: 'artifact',
      },
    })
    expect(tracker.handleMessage(start)).toEqual([])

    const delta = makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"type":"html"}' },
    })
    const events = tracker.handleMessage(delta)
    expect(events).toHaveLength(1)
  })

  test('ignores non-artifact tool blocks', () => {
    const tracker = new ArtifactPartialStreamTracker()

    const start = makeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_004',
        name: 'read',
      },
    })
    expect(tracker.handleMessage(start)).toEqual([])
  })

  test('clears block on content_block_stop', () => {
    const tracker = new ArtifactPartialStreamTracker()

    const start = makeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_005',
        name: 'create_artifact',
      },
    })
    tracker.handleMessage(start)

    const stop = makeStreamEvent({ type: 'content_block_stop', index: 0 })
    tracker.handleMessage(stop)

    // After stop, deltas should not be tracked
    const delta = makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: 'should not appear' },
    })
    expect(tracker.handleMessage(delta)).toEqual([])
  })

  test('builds final events from assistant message', () => {
    const tracker = new ArtifactPartialStreamTracker()

    const events = tracker.buildFinalEvents(makeAssistantMessage([
      { type: 'tool_use', id: 'toolu_010', name: 'create_artifact', input: { title: 'Chart', type: 'html', content: '<svg/>' } },
      { type: 'text', text: 'Here is your chart:' },
    ]))

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('artifact_stream_end')
    expect(asStreamEndEvent(events[0]!).toolUseId).toBe('toolu_010')
    expect(asStreamEndEvent(events[0]!).input).toEqual({ title: 'Chart', type: 'html', content: '<svg/>' })
  })

  test('accumulates partial JSON across deltas', () => {
    const tracker = new ArtifactPartialStreamTracker()

    tracker.handleMessage(makeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_020', name: 'create_artifact' },
    }))

    tracker.handleMessage(makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"title":"He' },
    }))
    tracker.handleMessage(makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: 'llo"}' },
    }))

    // buildFinalEvents captures the completed input
    const events = tracker.buildFinalEvents(makeAssistantMessage([
      { type: 'tool_use', id: 'toolu_020', name: 'create_artifact', input: { title: 'Hello' } },
    ]))
    expect(events).toHaveLength(1)
    expect(asStreamEndEvent(events[0]!).input).toEqual({ title: 'Hello' })
  })
})
