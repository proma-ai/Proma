export interface LiveMarkdownPropertyEntry {
  key: string
  value: string
}

export interface LiveMarkdownFrontmatterRange {
  /** 1-indexed closing delimiter line. */
  endLine: number
}

const SAFE_KEY_RE = /^[\p{L}_][\p{L}\p{N}_-]*$/u
const BLOCK_SCALAR_RE = /^[>|][+-]?\d*$/

function isSafeFlatEntry(key: string, value: string): boolean {
  // A lossless YAML AST is not available here. Accept only plain scalars whose
  // meaning survives the simple `key: value` serializer.
  if (!SAFE_KEY_RE.test(key)) return false
  if (BLOCK_SCALAR_RE.test(value)) return false
  if (/^[&*!?]/.test(value)) return false
  if (/^[\[\]{}'"`]/.test(value)) return false
  if (value.includes(':')) return false
  if (/(?:^|\s)#/.test(value)) return false
  return true
}

/**
 * Finds a leading fenced YAML region without claiming that its contents are
 * editable. This lets complex frontmatter remain raw source instead of being
 * accidentally interpreted as Markdown blocks.
 */
export function getLeadingFrontmatterRange(lines: readonly string[]): LiveMarkdownFrontmatterRange | null {
  if (lines[0]?.replace(/^\uFEFF/, '') !== '---') return null
  const closingLine = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  return closingLine > 1 ? { endLine: closingLine + 1 } : null
}

/**
 * Parse the conservative subset of YAML frontmatter that Proma can safely edit
 * without reserializing unrelated YAML syntax. Nested values remain source text.
 */
export function parseLeadingFrontmatter(lines: readonly string[]): LiveMarkdownPropertyEntry[] | null {
  const range = getLeadingFrontmatterRange(lines)
  if (!range) return null

  const source = lines.slice(1, range.endLine - 1)
  const entries = source.map((line) => {
    if (/^\s+/.test(line)) return null
    const match = line.match(/^([^:]+):[ \t]*(.*)$/)
    if (!match) return null
    const key = match[1] ?? ''
    const value = match[2] ?? ''
    return isSafeFlatEntry(key, value) ? { key, value } : null
  })
  // Editing must never flatten nested YAML, comments, quoted keys/scalars,
  // flow collections, complex colon values, or block scalars. Those remain
  // source text until the renderer gains a lossless YAML AST.
  return entries.length > 0 && entries.every((entry) => entry !== null)
    ? entries as LiveMarkdownPropertyEntry[]
    : null
}

/** Returns the 1-indexed closing delimiter line together with editable entries. */
export function getLeadingFrontmatter(lines: readonly string[]): { endLine: number; entries: LiveMarkdownPropertyEntry[] } | null {
  const entries = parseLeadingFrontmatter(lines)
  const range = getLeadingFrontmatterRange(lines)
  return entries && range ? { endLine: range.endLine, entries } : null
}

/**
 * Replaces only a currently safe, flat frontmatter mapping. Callers must pass
 * the editor's current document rather than a render-time props snapshot.
 */
export function serializeFlatLeadingFrontmatter(documentValue: string, entries: readonly LiveMarkdownPropertyEntry[]): string {
  const newline = documentValue.includes('\r\n') ? '\r\n' : '\n'
  const lines = documentValue.replace(/\r\n?/g, '\n').split('\n')
  const frontmatter = getLeadingFrontmatter(lines)
  if (!frontmatter || !entries.every((entry) => isSafeFlatEntry(entry.key, entry.value))) return documentValue
  return [
    ...lines.slice(0, 1),
    ...entries.map(({ key, value }) => `${key}: ${value}`),
    ...lines.slice(frontmatter.endLine - 1),
  ].join(newline)
}
