import { describe, expect, test } from 'bun:test'
import {
  MAX_GENERATIVE_WIDGET_CODE_CHARS,
  isGenerativeUiGuidelineToolName,
  isGenerativeUiToolName,
  parseGenerativeWidgetInput,
  parseGenerativeWidgetOwnerFromToolResult,
  parsePartialGenerativeWidgetInputJson,
} from './generative-ui-contract'

describe('Generative UI contract', () => {
  test('parses snake_case show_widget input into a replayable artifact', () => {
    const result = parseGenerativeWidgetInput({
      title: 'Sales chart',
      widget_code: '<svg viewBox="0 0 10 10"></svg>',
      description: 'Quarterly sales',
      initial_height: 320,
      layout: 'compact',
      preferred_width: 420,
      interaction_mode: 'render-only',
    }, { sessionId: 's1', workspaceId: 'w1', toolUseId: 'tu1' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.artifact.id).toBe('widget-tu1')
    expect(result.artifact.widgetCode).toContain('<svg')
    expect(result.artifact.initialHeight).toBe(320)
    expect(result.artifact.layout).toBe('compact')
    expect(result.artifact.preferredWidth).toBe(420)
    expect(result.artifact.interactionMode).toBe('render-only')
    expect(result.artifact.owner.sessionId).toBe('s1')
  })

  test('accepts camelCase compatibility without changing the primary tool contract', () => {
    const result = parseGenerativeWidgetInput({
      title: 'Compatibility',
      widgetCode: '<div>ok</div>',
      initialHeight: 10_000,
      preferredWidth: 10_000,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.artifact.initialHeight).toBe(2000)
    expect(result.artifact.preferredWidth).toBe(1600)
    expect(result.artifact.interactionMode).toBe('interactive')
  })

  test('rejects missing and oversized widget_code', () => {
    const missing = parseGenerativeWidgetInput({ title: 'bad' })
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('expected missing widget_code to fail')
    expect(missing.reason).toContain('widget_code')

    const oversized = parseGenerativeWidgetInput({
      title: 'too big',
      widget_code: 'x'.repeat(MAX_GENERATIVE_WIDGET_CODE_CHARS + 1),
    })
    expect(oversized.ok).toBe(false)
    if (oversized.ok) throw new Error('expected oversized widget_code to fail')
    expect(oversized.reason).toContain(String(MAX_GENERATIVE_WIDGET_CODE_CHARS))
  })

  test('does not treat raw HTML strings as executable widget artifacts', () => {
    const result = parseGenerativeWidgetInput('<div>raw html</div>' as unknown as Record<string, unknown>)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected raw string input to fail')
    expect(result.reason).toContain('object')
  })

  test('preserves quotes, newlines, and backslashes in widget_code', () => {
    const widgetCode = [
      '<div data-label="a \\"quoted\\" value">',
      'line one\\nline two\\\\tail',
      '</div>',
    ].join('\n')
    const result = parseGenerativeWidgetInput({
      title: 'Escapes',
      widget_code: widgetCode,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.artifact.widgetCode).toBe(widgetCode)
  })

  test('progressively parses partial show_widget JSON fragments', () => {
    const partial = '{"title":"Live \\"Widget\\"","description":"streaming","widget_code":"<div data-value=\\"a\\\\b\\">line\\nnext</div>","layout":"compact","preferred_width":420'
    const parsed = parsePartialGenerativeWidgetInputJson(partial)

    expect(parsed?.title).toBe('Live "Widget"')
    expect(parsed?.description).toBe('streaming')
    expect(parsed?.widget_code).toBe('<div data-value="a\\b">line\nnext</div>')
    expect(parsed?.layout).toBe('compact')
    expect(parsed?.preferred_width).toBe(420)
  })

  test('uses normal JSON parsing when partial show_widget args are already complete', () => {
    const parsed = parsePartialGenerativeWidgetInputJson(JSON.stringify({
      title: 'Complete',
      widget_code: '<div>done</div>',
      initial_height: 260,
    }))

    expect(parsed?.title).toBe('Complete')
    expect(parsed?.widget_code).toBe('<div>done</div>')
    expect(parsed?.initial_height).toBe(260)
  })

  test('parses multiple widget artifacts independently', () => {
    const first = parseGenerativeWidgetInput({
      title: 'First',
      widget_code: '<div>one</div>',
    }, { toolUseId: 'tool-a' })
    const second = parseGenerativeWidgetInput({
      title: 'Second',
      widget_code: '<div>two</div>',
    }, { toolUseId: 'tool-b' })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('expected both widgets to parse')
    expect(first.artifact.id).toBe('widget-tool-a')
    expect(second.artifact.id).toBe('widget-tool-b')
    expect(first.artifact.widgetCode).toContain('one')
    expect(second.artifact.widgetCode).toContain('two')
  })

  test('uses stable generated ids for replayed widgets without tool_use ids', () => {
    const input = {
      title: 'Stable replay',
      widget_code: '<div>same persisted widget</div>',
    }
    const first = parseGenerativeWidgetInput(input)
    const second = parseGenerativeWidgetInput(input)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('expected both widgets to parse')
    expect(first.artifact.id).toBe(second.artifact.id)
  })

  test('records pin target as artifact owner persistence metadata', () => {
    const result = parseGenerativeWidgetInput({
      title: 'Pinned dashboard',
      widget_code: '<div>pin me</div>',
      pin_target: 'dashboard',
    }, { sessionId: 's1', workspaceId: 'w1' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.artifact.owner.pinnedTo).toBe('dashboard')
  })

  test('matches plain and MCP-prefixed tool names', () => {
    expect(isGenerativeUiToolName('show_widget')).toBe(true)
    expect(isGenerativeUiToolName('mcp__generative-ui__show_widget')).toBe(true)
    expect(isGenerativeUiToolName('Read')).toBe(false)

    expect(isGenerativeUiGuidelineToolName('load_widget_guidelines')).toBe(true)
    expect(isGenerativeUiGuidelineToolName('mcp__generative-ui__load_widget_guidelines')).toBe(true)
    expect(isGenerativeUiGuidelineToolName('show_widget')).toBe(false)
  })

  test('recovers owner metadata from persisted show_widget tool_result', () => {
    const owner = parseGenerativeWidgetOwnerFromToolResult(JSON.stringify({
      type: 'generative_ui_widget',
      artifact: {
        owner: {
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          runId: 'run-1',
        },
        pinTarget: 'report',
      },
    }))

    expect(owner.sessionId).toBe('session-1')
    expect(owner.workspaceId).toBe('workspace-1')
    expect(owner.runId).toBe('run-1')
    expect(owner.pinnedTo).toBe('report')
    expect(parseGenerativeWidgetOwnerFromToolResult('not json')).toEqual({})
  })
})
