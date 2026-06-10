import { describe, expect, test } from 'bun:test'
import {
  GENERATIVE_UI_CDN_HOSTS,
  GENERATIVE_UI_IFRAME_SANDBOX,
  buildGenerativeWidgetSrcdoc,
  sanitizeGenerativeWidgetForIframe,
  sanitizeGenerativeWidgetForStreaming,
} from './generative-ui-sandbox'

describe('Generative UI sanitizer and sandbox', () => {
  test('streaming sanitizer removes script, handlers, containers, and dangerous URLs', () => {
    const html = [
      '<div onclick="alert(1)">ok</div>',
      '<script>alert(1)</script>',
      '<iframe src="x"></iframe>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<form action="/x"></form>',
      '<base href="https://evil.example/">',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<a href="javascript:alert(1)">bad</a>',
      '<img src="data:text/html,<script>alert(1)</script>">',
      '<p style="background:url(javascript:alert(1))">x</p>',
    ].join('')

    const result = sanitizeGenerativeWidgetForStreaming(html)
    expect(result).not.toContain('<script')
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('<object')
    expect(result).not.toContain('<embed')
    expect(result).not.toContain('<form')
    expect(result).not.toContain('<base')
    expect(result).not.toContain('<meta')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('data:text/html')
    expect(result).toContain('ok')
  })

  test('streaming sanitizer truncates an unclosed script before JS leaks as visible text', () => {
    const result = sanitizeGenerativeWidgetForStreaming('<div>safe</div><script>const leaked = true')
    expect(result).toBe('<div>safe</div>')
  })

  test('streaming sanitizer hides parent-DOM attack scripts before they can render as text', () => {
    const result = sanitizeGenerativeWidgetForStreaming([
      '<div>safe</div>',
      '<script>parent.document.body.innerHTML = "owned"</script>',
      '<p>after</p>',
    ].join(''))

    expect(result).toContain('<div>safe</div>')
    expect(result).toContain('<p>after</p>')
    expect(result).not.toContain('parent.document')
    expect(result).not.toContain('<script')
  })

  test('final sanitizer preserves inline scripts but strips handlers, unsafe containers, and URLs', () => {
    const result = sanitizeGenerativeWidgetForIframe([
      '<button onclick="run()">Run</button>',
      '<script>run()</script>',
      '<iframe src="x"></iframe>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<form action="/x"></form>',
      '<base href="https://evil.example/">',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<a href="javascript:alert(1)">bad</a>',
      '<img onerror="alert(1)" src="data:text/html,<script>alert(1)</script>">',
      '<p style="background:url(data:text/html,evil)">x</p>',
    ].join(''))

    expect(result).toContain('<script>run()</script>')
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('<object')
    expect(result).not.toContain('<embed')
    expect(result).not.toContain('<form')
    expect(result).not.toContain('<base')
    expect(result).not.toContain('<meta')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('data:text/html')
  })

  test('final sanitizer keeps whitelisted CDN scripts and removes other external scripts', () => {
    const allowed = `https://${GENERATIVE_UI_CDN_HOSTS[0]}/ajax/libs/d3/7.0.0/d3.min.js`
    const result = sanitizeGenerativeWidgetForIframe([
      `<script src="${allowed}"></script>`,
      '<script src="https://evil.example/x.js"></script>',
      '<script src="http://cdn.jsdelivr.net/x.js"></script>',
    ].join(''))

    expect(result).toContain(allowed)
    expect(result).not.toContain('evil.example')
    expect(result).not.toContain('http://cdn.jsdelivr.net')
  })

  test('srcdoc defines the sandbox receiver protocol and CSP boundaries', () => {
    const srcdoc = buildGenerativeWidgetSrcdoc(':root{--primary:#2563eb;}', true)

    expect(GENERATIVE_UI_IFRAME_SANDBOX).toBe('allow-scripts')
    expect(srcdoc).toContain('Content-Security-Policy')
    expect(srcdoc).toContain("default-src 'none'")
    expect(srcdoc).toContain("connect-src 'none'")
    expect(srcdoc).toContain("frame-src 'none'")
    expect(srcdoc).toContain("object-src 'none'")
    expect(srcdoc).toContain("base-uri 'none'")
    expect(srcdoc).toContain("form-action 'none'")
    expect(srcdoc).toContain('widget:ready')
    expect(srcdoc).toContain('widget:update')
    expect(srcdoc).toContain('widget:finalize')
    expect(srcdoc).toContain('widget:resize')
    expect(srcdoc).toContain('widget:error')
    expect(srcdoc).toContain('widget:scriptsReady')
    expect(srcdoc).toContain('ResizeObserver')
    expect(srcdoc).toContain('window.addEventListener(\'error\'')
    expect(srcdoc).toContain('unhandledrejection')
    expect(srcdoc).toContain('--color-background-primary')
    expect(srcdoc).toContain('--color-text-primary')
    expect(srcdoc).toContain('--border-radius-lg')
    expect(srcdoc).toContain('target.closest?target.closest(\'a[href]\')')
    expect(srcdoc).toContain('parent.postMessage({type:\'widget:link\'')
  })

  test('srcdoc only handles the known widget message protocol', () => {
    const srcdoc = buildGenerativeWidgetSrcdoc()

    expect(srcdoc).toContain("if(!event.data||typeof event.data.type!=='string')return;")
    expect(srcdoc).toContain("if(event.data.type==='widget:update')")
    expect(srcdoc).toContain("if(event.data.type==='widget:finalize')")
    expect(srcdoc).toContain("if(event.data.type==='widget:theme'")
    expect(srcdoc).not.toContain('eval(event.data')
    expect(srcdoc).not.toContain('new Function(event.data')
  })

  test('runtime finalization loads CDN scripts before inline scripts', () => {
    const srcdoc = buildGenerativeWidgetSrcdoc()

    expect(srcdoc).toContain('var cdn=scripts.filter(function(s){return !!s.src});')
    expect(srcdoc).toContain('var inline=scripts.filter(function(s){return !s.src&&s.text});')
    expect(srcdoc).toContain('if(pending<=0)runInline();')
    expect(srcdoc).toContain('root.appendChild(s);')
    expect(srcdoc.indexOf('if(pending<=0)runInline();')).toBeLessThan(srcdoc.indexOf('for(var c=0;c<cdn.length;c++){'))
  })

  test('streaming preview strips scripts while final sanitizer keeps allowed scripts for finalize', () => {
    const html = [
      '<div id="shell">loading</div>',
      '<script>document.getElementById("shell").textContent = "ready"</script>',
    ].join('')

    const streaming = sanitizeGenerativeWidgetForStreaming(html)
    const final = sanitizeGenerativeWidgetForIframe(html)

    expect(streaming).toContain('loading')
    expect(streaming).not.toContain('<script')
    expect(final).toContain('loading')
    expect(final).toContain('<script>')
  })
})
