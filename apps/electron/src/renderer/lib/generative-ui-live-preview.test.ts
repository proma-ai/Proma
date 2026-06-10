import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import {
  buildLiveGenerativeWidgetPreviewFromFinalEvent,
  buildLiveGenerativeWidgetPreviewFromStreamEvent,
  getGenerativeUiToolUseIds,
  stripPreviewedGenerativeWidgetBlocks,
} from './generative-ui-live-preview'

describe('Generative UI live preview helpers', () => {
  test('builds streaming previews from partial widget JSON events', () => {
    const preview = buildLiveGenerativeWidgetPreviewFromStreamEvent({
      type: 'generative_ui_widget_stream',
      toolUseId: 'tool-1',
      toolName: 'show_widget',
      partialJson: '{"title":"Preview","widget_code":"<div>partial',
      parentToolUseId: null,
      updatedAt: 1,
    })

    expect(preview).toMatchObject({
      toolUseId: 'tool-1',
      title: 'Preview',
      widgetCode: '<div>partial',
      isStreaming: true,
    })
  })

  test('builds finalized previews from complete show_widget input', () => {
    const preview = buildLiveGenerativeWidgetPreviewFromFinalEvent({
      type: 'generative_ui_widget_stream_end',
      toolUseId: 'tool-2',
      toolName: 'show_widget',
      input: {
        title: 'Final',
        widget_code: '<div>done</div>',
        layout: 'compact',
        preferred_width: 360,
      },
      parentToolUseId: null,
      updatedAt: 2,
    })

    expect(preview).toMatchObject({
      toolUseId: 'tool-2',
      title: 'Final',
      widgetCode: '<div>done</div>',
      layout: 'compact',
      preferredWidth: 360,
      isStreaming: false,
      finalized: true,
    })
  })

  test('strips already-previewed show_widget blocks from live assistant messages', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'before' },
          {
            type: 'tool_use',
            id: 'tool-3',
            name: 'mcp__generative-ui__show_widget',
            input: { title: 'Widget', widget_code: '<div>widget</div>' },
          },
          { type: 'tool_use', id: 'tool-4', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage

    expect(getGenerativeUiToolUseIds(message)).toEqual(['tool-3'])

    const stripped = stripPreviewedGenerativeWidgetBlocks(message, new Set(['tool-3']))
    expect(stripped).not.toBeNull()
    const content = (stripped as unknown as { message: { content: Array<Record<string, unknown>> } }).message.content
    expect(content).toHaveLength(2)
    expect(content.some((block) => block.id === 'tool-3')).toBe(false)
    expect(content.some((block) => block.id === 'tool-4')).toBe(true)
  })

  test('returns null when an assistant message only contains a previewed widget block', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'tool-5',
          name: 'show_widget',
          input: { title: 'Widget', widget_code: '<div>widget</div>' },
        }],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage

    expect(stripPreviewedGenerativeWidgetBlocks(message, new Set(['tool-5']))).toBeNull()
  })
})
