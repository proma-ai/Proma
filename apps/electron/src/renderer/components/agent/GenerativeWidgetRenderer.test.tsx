import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'bun:test'
import { parseGenerativeWidgetInput } from '@/lib/generative-ui-contract'
import { GenerativeWidgetRenderer } from './GenerativeWidgetRenderer'

describe('GenerativeWidgetRenderer', () => {
  test('renders a sandboxed iframe for valid widget artifacts', () => {
    const parseResult = parseGenerativeWidgetInput({
      title: 'Revenue widget',
      widget_code: '<div style="height:120px">Revenue</div>',
      description: 'A compact revenue surface',
    }, { sessionId: 's1', toolUseId: 'tu1' })

    const markup = renderToStaticMarkup(<GenerativeWidgetRenderer parseResult={parseResult} />)
    expect(markup).toContain('Revenue widget')
    expect(markup).toContain('A compact revenue surface')
    expect(markup).toContain('sandbox="allow-scripts"')
    expect(markup).toContain('Content-Security-Policy')
    expect(markup).toContain('widget:finalize')
    expect(markup).toContain('widget:error')
    expect(markup).toContain('aria-label="查看生成代码"')
    expect(markup).toContain('aria-label="放大查看生成式 UI"')
  })

  test('renders a visible fallback for malformed widget artifacts', () => {
    const parseResult = parseGenerativeWidgetInput({ title: 'Broken widget' })

    const markup = renderToStaticMarkup(<GenerativeWidgetRenderer parseResult={parseResult} />)
    expect(markup).toContain('Broken widget')
    expect(markup).toContain('无法渲染')
    expect(markup).toContain('widget_code')
  })

  test('infers compact shell width for legacy small widgets with narrow max-width', () => {
    const parseResult = parseGenerativeWidgetInput({
      title: 'LiveSmoke Counter',
      initial_height: 220,
      widget_code: [
        '<style>',
        'body { background: #0f0f13; display:flex; justify-content:center; }',
        '.w { width: 100%; max-width: 380px; }',
        '</style>',
        '<div class="w">Counter</div>',
      ].join(''),
    })

    const markup = renderToStaticMarkup(<GenerativeWidgetRenderer parseResult={parseResult} />)
    expect(markup).toContain('LiveSmoke Counter')
    expect(markup).toContain('mx-auto')
    expect(markup).toContain('max-width:380px')
  })

  test('uses explicit preferred width from the widget contract', () => {
    const parseResult = parseGenerativeWidgetInput({
      title: 'Compact KPI',
      layout: 'compact',
      preferred_width: 480,
      widget_code: '<div class="kpi">42</div>',
    })

    const markup = renderToStaticMarkup(<GenerativeWidgetRenderer parseResult={parseResult} />)
    expect(markup).toContain('Compact KPI')
    expect(markup).toContain('max-width:480px')
  })

  test('keeps streaming widgets visible with the non-final runtime protocol', () => {
    const parseResult = parseGenerativeWidgetInput({
      title: 'Streaming Preview',
      widget_code: '<div>partial preview</div><script>window.done=true</script>',
      initial_height: 180,
    })

    const markup = renderToStaticMarkup(<GenerativeWidgetRenderer parseResult={parseResult} isStreaming />)
    expect(markup).toContain('Streaming Preview')
    expect(markup).toContain('opacity-95')
    expect(markup).toContain('widget:update')
    expect(markup).toContain('widget:finalize')
  })
})
