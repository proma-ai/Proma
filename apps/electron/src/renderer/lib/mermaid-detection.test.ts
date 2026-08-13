import { describe, expect, test } from 'bun:test'
import { shouldRenderMermaidCodeBlock } from './mermaid-detection'

describe('Mermaid code block detection', () => {
  test('recognizes a Gantt block without a language class', () => {
    expect(shouldRenderMermaidCodeBlock(undefined, [
      'gantt',
      '  title Delivery plan',
      '  section Build',
      '  API :done, api, 2026-08-13, 2d',
    ].join('\n'))).toBe(true)
  })

  test('recognizes other Mermaid diagram types after rich editor round trips', () => {
    expect(shouldRenderMermaidCodeBlock('language-mermaid', 'sequenceDiagram\n  A->>B: Hello')).toBe(true)
    expect(shouldRenderMermaidCodeBlock('language-mmd', 'flowchart TD\n  A-->B')).toBe(true)
  })

  test('does not classify ordinary text code as Mermaid', () => {
    expect(shouldRenderMermaidCodeBlock('language-javascript', 'const graph = []')).toBe(false)
    expect(shouldRenderMermaidCodeBlock(undefined, 'graph of results')).toBe(false)
  })
})
