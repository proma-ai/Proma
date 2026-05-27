const MERMAID_START_KEYWORDS = [
  'graph',
  'flowchart',
  'flowchart-elk',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'xychart-beta',
  'block',
  'block-beta',
  'packet',
  'packet-beta',
  'architecture',
  'architecture-beta',
  'sankey',
  'sankey-beta',
  'requirementDiagram',
  'kanban',
  'radar-beta',
  'treeView-beta',
  'treemap',
  'venn-beta',
  'ishikawa-beta',
  'wardley-beta',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
] as const

const MERMAID_START_PATTERN = new RegExp(
  `^(?:${MERMAID_START_KEYWORDS.map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
)
const LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-\S+/i
const MERMAID_LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-(?:mermaid|mmd)(?:\s|$)/i
const MERMAID_DIRECTIVE_PATTERN = /^%%\{[\s\S]*\}%%$/
const MERMAID_COMMENT_PATTERN = /^%%(?!\{)/

export function isMermaidLanguage(language: string): boolean {
  return /^(?:mermaid|mmd)$/i.test(language.trim())
}

export function looksLikeMermaidDefinition(code: string): boolean {
  for (const line of code.trimStart().split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate || MERMAID_DIRECTIVE_PATTERN.test(candidate) || MERMAID_COMMENT_PATTERN.test(candidate)) continue
    return MERMAID_START_PATTERN.test(candidate)
  }
  return false
}

export function shouldInspectMermaidCodeBlock(className: string | undefined): boolean {
  if (className && MERMAID_LANGUAGE_CLASS_PATTERN.test(className)) return true
  if (className && LANGUAGE_CLASS_PATTERN.test(className)) return false
  return true
}

export function shouldRenderMermaidCodeBlock(className: string | undefined, code: string): boolean {
  if (className && MERMAID_LANGUAGE_CLASS_PATTERN.test(className)) return true
  if (className && LANGUAGE_CLASS_PATTERN.test(className)) return false
  return looksLikeMermaidDefinition(code)
}
