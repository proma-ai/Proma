import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { GenerativeUiPartialWidgetTracker } from './generative-ui-partial-stream'

function streamEvent(event: Record<string, unknown>): SDKMessage {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: null,
    session_id: 'session-1',
  } as unknown as SDKMessage
}

describe('GenerativeUiPartialWidgetTracker', () => {
  test('emits transient stream events for show_widget input JSON deltas', () => {
    const tracker = new GenerativeUiPartialWidgetTracker()
    const startEvents = tracker.handleMessage(streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'mcp_tool_use',
        id: 'tool-1',
        name: 'show_widget',
        server_name: 'generative-ui',
        input: {},
      },
    }))

    expect(startEvents).toEqual([])

    const deltaEvents = tracker.handleMessage(streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"title":"Live","widget_code":"<div>pre',
      },
    }))

    expect(deltaEvents).toHaveLength(1)
    expect(deltaEvents[0]).toMatchObject({
      type: 'generative_ui_widget_stream',
      toolUseId: 'tool-1',
      toolName: 'show_widget',
      partialJson: '{"title":"Live","widget_code":"<div>pre',
    })
  })

  test('ignores partial JSON for non show_widget tools', () => {
    const tracker = new GenerativeUiPartialWidgetTracker()
    tracker.handleMessage(streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'tool-2',
        name: 'Read',
        input: {},
      },
    }))

    const events = tracker.handleMessage(streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"file_path":"/tmp/a"}',
      },
    }))

    expect(events).toEqual([])
  })

  test('emits stream_end for complete show_widget assistant tool_use blocks', () => {
    const tracker = new GenerativeUiPartialWidgetTracker()
    const events = tracker.buildFinalEvents({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'tool-3',
          name: 'mcp__generative-ui__show_widget',
          input: {
            title: 'Final',
            widget_code: '<div>done</div>',
          },
        }],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'generative_ui_widget_stream_end',
      toolUseId: 'tool-3',
      toolName: 'mcp__generative-ui__show_widget',
      input: {
        title: 'Final',
        widget_code: '<div>done</div>',
      },
    })
  })
})
