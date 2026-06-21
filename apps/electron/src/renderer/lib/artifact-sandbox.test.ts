import { describe, test, expect } from 'bun:test'
import {
  sanitizeArtifactForStreaming,
  sanitizeArtifactForIframe,
  buildArtifactSrcdoc,
  ARTIFACT_CDN_HOSTS,
  ARTIFACT_IFRAME_SANDBOX,
} from './artifact-sandbox'

describe('artifact-sandbox', () => {
  describe('sanitizeArtifactForStreaming', () => {
    test('strips script tags', () => {
      const html = '<div>Hello</div><script>alert("xss")</script>'
      const result = sanitizeArtifactForStreaming(html)
      expect(result).not.toContain('<script')
      expect(result).toContain('<div>Hello</div>')
    })

    test('strips event handlers', () => {
      const html = '<div onclick="alert(1)">Click</div>'
      const result = sanitizeArtifactForStreaming(html)
      expect(result).not.toContain('onclick')
    })

    test('strips dangerous URLs', () => {
      const html = '<a href="javascript:alert(1)">link</a>'
      const result = sanitizeArtifactForStreaming(html)
      expect(result).not.toContain('javascript:')
    })

    test('strips dangerous container tags', () => {
      const html = '<iframe src="https://evil.com"></iframe>'
      const result = sanitizeArtifactForStreaming(html)
      expect(result).not.toContain('iframe')
    })

    test('strips unclosed script at end', () => {
      const html = '<div>partial</div><script>var x='
      const result = sanitizeArtifactForStreaming(html)
      expect(result).not.toContain('<script')
      expect(result).toContain('<div>partial</div>')
    })
  })

  describe('sanitizeArtifactForIframe', () => {
    test('allows CDN scripts from whitelisted hosts', () => {
      const html = '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'
      const result = sanitizeArtifactForIframe(html)
      expect(result).toContain('cdn.jsdelivr.net')
    })

    test('blocks non-CDN scripts', () => {
      const html = '<script src="https://evil.com/steal.js"></script>'
      const result = sanitizeArtifactForIframe(html)
      expect(result).not.toContain('evil.com')
    })

    test('allows inline scripts', () => {
      const html = '<script>console.log("ok")</script>'
      const result = sanitizeArtifactForIframe(html)
      expect(result).toContain('console.log')
    })
  })

  describe('buildArtifactSrcdoc', () => {
    test('returns valid HTML with CSP meta tag', () => {
      const result = buildArtifactSrcdoc()
      expect(result).toContain('<!DOCTYPE html>')
      expect(result).toContain('Content-Security-Policy')
      expect(result).toContain('<div id="__root"></div>')
    })

    test('includes custom style block', () => {
      const style = '.my-class{color:red;}'
      const result = buildArtifactSrcdoc(style)
      expect(result).toContain(style)
    })

    test('uses dark class when isDark is true', () => {
      const result = buildArtifactSrcdoc('', true)
      expect(result).toContain('<html class="dark">')
    })
  })

  describe('constants', () => {
    test('ARTIFACT_CDN_HOSTS contains expected hosts', () => {
      expect(ARTIFACT_CDN_HOSTS).toContain('cdn.jsdelivr.net')
      expect(ARTIFACT_CDN_HOSTS).toContain('unpkg.com')
    })

    test('ARTIFACT_IFRAME_SANDBOX allows scripts', () => {
      expect(ARTIFACT_IFRAME_SANDBOX).toBe('allow-scripts')
    })
  })
})
