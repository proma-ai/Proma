import { describe, expect, test } from 'bun:test'
import {
  isMermaidLanguage,
  looksLikeMermaidDefinition,
  shouldInspectMermaidCodeBlock,
  shouldRenderMermaidCodeBlock,
} from './mermaid-detection'

describe('Mermaid 代码块识别', () => {
  test('given mermaid language when checking code block then renders as diagram', () => {
    expect(shouldRenderMermaidCodeBlock('language-mermaid', 'graph TD\nA-->B')).toBe(true)
    expect(shouldRenderMermaidCodeBlock('language-mmd', 'sequenceDiagram\nA->>B: hi')).toBe(true)
    expect(isMermaidLanguage('Mermaid')).toBe(true)
  })

  test('given untyped Mermaid content when checking code block then renders as diagram', () => {
    expect(looksLikeMermaidDefinition('flowchart LR\nA --> B')).toBe(true)
    expect(shouldRenderMermaidCodeBlock(undefined, 'sequenceDiagram\nA->>B: hi')).toBe(true)
  })

  test('given Mermaid extended diagram types when checking code block then renders as diagram', () => {
    const definitions = [
      'pie showData\n"Chrome" : 62',
      'gitGraph\ncommit id: "init"',
      'timeline\ntitle 团队成长大事记',
      'block\ncolumns 3',
      'block-beta\ncolumns 3',
      'packet-beta\n0-15: "Source Port"',
      'architecture-beta\ngroup api(cloud)[API]',
      'sankey-beta\nA,B,10',
      'mindmap\nroot((Proma))',
    ]

    definitions.forEach((definition) => {
      expect(shouldRenderMermaidCodeBlock(undefined, definition)).toBe(true)
    })
  })

  test('given Mermaid v11 diagram types when checking code block then renders as diagram', () => {
    const definitions = [
      'kanban\n  todo[Todo]',
      'radar-beta\ntitle Skills',
      'treeView-beta\nroot',
      'treemap\n"Root"',
      'venn-beta\nA, B',
      'ishikawa-beta\nRoot cause',
      'wardley-beta\ntitle Strategy',
      'flowchart-elk TD\nA --> B',
      'C4Container\nContainer(app, "Proma")',
      'C4Component\nComponent(ui, "UI")',
    ]

    definitions.forEach((definition) => {
      expect(shouldRenderMermaidCodeBlock(undefined, definition)).toBe(true)
    })
  })

  test('given Mermaid directive or comment before diagram when checking code block then renders as diagram', () => {
    const definitions = [
      '%%{init: {"theme": "dark"}}%%\nflowchart TD\nA --> B',
      '%% 注释\nsequenceDiagram\nA->>B: hi',
    ]

    definitions.forEach((definition) => {
      expect(shouldRenderMermaidCodeBlock(undefined, definition)).toBe(true)
    })
  })

  test('given non-Mermaid language when checking code block then keeps source code', () => {
    expect(shouldInspectMermaidCodeBlock('language-ts')).toBe(false)
    expect(shouldRenderMermaidCodeBlock('language-ts', 'graph TD\nA-->B')).toBe(false)
    expect(shouldInspectMermaidCodeBlock(undefined)).toBe(true)
    expect(shouldRenderMermaidCodeBlock(undefined, 'const graph = createGraph()')).toBe(false)
  })
})
