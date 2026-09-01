export type LiveMarkdownTableAlignment = 'left' | 'center' | 'right' | null

export interface LiveMarkdownTable {
  header: string[]
  rows: string[][]
  alignments: LiveMarkdownTableAlignment[]
}

function splitTableRow(line: string): string[] {
  const content = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? ''
    if (character === '\\' && content[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (character === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells
}

function parseAlignment(cell: string): LiveMarkdownTableAlignment | undefined {
  if (!/^:?-{3,}:?$/.test(cell)) return undefined
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
  if (cell.startsWith(':')) return 'left'
  if (cell.endsWith(':')) return 'right'
  return null
}

export function isLiveMarkdownTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length >= 2 && cells.every((cell) => parseAlignment(cell) !== undefined)
}

/** Parses a complete GFM table source block, including its separator row. */
export function parseLiveMarkdownTable(source: string): LiveMarkdownTable | null {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length < 2 || !lines[0]?.includes('|') || !isLiveMarkdownTableSeparator(lines[1] ?? '')) return null

  const header = splitTableRow(lines[0] ?? '')
  const alignments = splitTableRow(lines[1] ?? '').map((cell) => parseAlignment(cell) ?? null)
  const rows = lines.slice(2)
    .filter((line) => line.trim() && line.includes('|'))
    .map(splitTableRow)
  const width = Math.max(header.length, alignments.length, ...rows.map((row) => row.length))
  if (width < 2) return null

  return {
    header: Array.from({ length: width }, (_, index) => header[index] ?? ''),
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? '')),
    alignments: Array.from({ length: width }, (_, index) => alignments[index] ?? null),
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function serializeSeparator(alignment: LiveMarkdownTableAlignment): string {
  if (alignment === 'left') return ':---'
  if (alignment === 'center') return ':---:'
  if (alignment === 'right') return '---:'
  return '---'
}

/** Serializes the editable grid as a normalized, re-parseable GFM table. */
export function serializeLiveMarkdownTable(table: LiveMarkdownTable): string {
  const width = Math.max(2, table.header.length, table.alignments.length, ...table.rows.map((row) => row.length))
  const formatRow = (row: readonly string[]): string => `| ${Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? '')).join(' | ')} |`
  const header = Array.from({ length: width }, (_, index) => table.header[index] ?? '')
  const separator = Array.from({ length: width }, (_, index) => serializeSeparator(table.alignments[index] ?? null))
  const rows = table.rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''))
  return [formatRow(header), formatRow(separator), ...rows.map(formatRow)].join('\n')
}

export function isLikelyLiveMarkdownLatex(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/\\(?:begin|end)\s*\{[^}]+\}/.test(trimmed)) return true
  if (/\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|oint|lim|sin|cos|tan|log|ln|cdot|times|div|pm|mp|leq|geq|neq|approx|equiv|infty|partial|nabla|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|to|Rightarrow|Leftarrow|Leftrightarrow|cup|cap|setminus|emptyset|subset|subseteq|supset|supseteq|in|notin|forall|exists|land|lor|not|bar|hat|vec|dot|ddot|left|right|quad|qquad)\b/.test(trimmed)) return true
  // A single-letter variable plus an exponent/subscript is a common compact LaTeX
  // form. Requiring braces for subscripts avoids rendering ordinary code such as
  // `file_name` and `v1_2` as math.
  return /^[A-Za-z](?:\^(?:\{[^}\n]+\}|[A-Za-z0-9+\-=()])|_\{[^}\n]+\})$/.test(trimmed)
}

export function shouldCommitLiveMarkdownTableCell(currentValue: string, draft: string): boolean {
  return currentValue !== draft
}

export function nextLiveMarkdownTableCell(
  table: LiveMarkdownTable,
  from: { row: number; column: number },
  backwards: boolean,
): { row: number; column: number } {
  const width = table.header.length
  const height = table.rows.length + 1
  if (width === 0 || height === 0) return from
  const index = from.row * width + from.column
  const offset = backwards ? -1 : 1
  const next = (index + offset + width * height) % (width * height)
  return { row: Math.floor(next / width), column: next % width }
}
export function updateLiveMarkdownTableCell(
  table: LiveMarkdownTable,
  rowIndex: number,
  columnIndex: number,
  value: string,
): LiveMarkdownTable {
  if (rowIndex < 0 || columnIndex < 0) return table
  if (rowIndex === 0) {
    const header = [...table.header]
    header[columnIndex] = value
    return { ...table, header }
  }
  const rows = table.rows.map((row) => [...row])
  if (!rows[rowIndex - 1]) return table
  rows[rowIndex - 1]![columnIndex] = value
  return { ...table, rows }
}
