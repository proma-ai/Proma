import * as React from 'react'
import { renderMarkdownMath } from '@/lib/markdown-math'
import {
  type LiveMarkdownTable,
  isLikelyLiveMarkdownLatex,
  nextLiveMarkdownTableCell,
  shouldCommitLiveMarkdownTableCell,
  updateLiveMarkdownTableCell,
} from './live-markdown-table'
import type { LiveMarkdownFindController, LiveMarkdownFindOptions, LiveMarkdownFindState } from './LiveMarkdownPreview'

const { useEffect, useRef, useState } = React

export interface LiveMarkdownTableCell {
  row: number
  column: number
}

interface LiveMarkdownTableEditorProps {
  table: LiveMarkdownTable
  readOnly: boolean
  autoFocusCell?: LiveMarkdownTableCell | null
  onCommit: (table: LiveMarkdownTable, focusCell?: LiveMarkdownTableCell) => void
  onMeasure: () => void
  findController?: LiveMarkdownFindController
  sourceRange?: { from: number; to: number }
  /** 原始 GFM 表格源码，用于将当前搜索结果精确映射回单元格。 */
  source?: string
}

const EMPTY_FIND_STATE: LiveMarkdownFindState = {
  query: '',
  options: { caseSensitive: false, wholeWord: false, regex: false },
  activeMatchFrom: null,
}

export function doesLiveMarkdownTableCellMatch(value: string, query: string, options: LiveMarkdownFindOptions): boolean {
  if (!query) return false
  try {
    const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const wrappedSource = options.wholeWord ? `\\b(?:${source})\\b` : source
    return new RegExp(wrappedSource, options.caseSensitive ? '' : 'i').test(value)
  } catch {
    return false
  }
}

function cellValue(table: LiveMarkdownTable, { row, column }: LiveMarkdownTableCell): string {
  return row === 0 ? table.header[column] ?? '' : table.rows[row - 1]?.[column] ?? ''
}

export function findLiveMarkdownTableCellSourceRange(source: string | undefined, sourceRange: { from: number; to: number } | undefined, cell: LiveMarkdownTableCell): { from: number; to: number } | null {
  if (!source || !sourceRange) return null
  // row=0 为表头；body 的第一个 row 需要跳过分隔行。
  const lineIndex = cell.row === 0 ? 0 : cell.row + 1
  const lines = source.split('\n')
  const line = lines[lineIndex]
  if (line === undefined) return null
  const lineOffset = sourceRange.from + lines.slice(0, lineIndex).reduce((offset, current) => offset + current.length + 1, 0)
  const cells: Array<{ from: number; to: number }> = []
  let start = line.startsWith('|') ? 1 : 0
  let escaped = false
  for (let index = start; index <= line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|' || index === line.length) {
      let from = start
      let to = index
      while (from < to && /\s/.test(line[from] ?? '')) from += 1
      while (to > from && /\s/.test(line[to - 1] ?? '')) to -= 1
      cells.push({ from: lineOffset + from, to: lineOffset + to })
      start = index + 1
    }
  }
  return cells[cell.column] ?? null
}

function renderInlineMath(value: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const pattern = /(^|[^\\])(?:\$([^$\n]+)\$|\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|`([^`\n]+)`)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    const prefix = match[1] ?? ''
    const start = match.index
    if (start > cursor) parts.push(value.slice(cursor, start))
    if (prefix) parts.push(prefix)
    const code = match[5]
    const latex = match[2] ?? match[3] ?? match[4] ?? (code && isLikelyLiveMarkdownLatex(code) ? code : null)
    const displayMode = Boolean(match[4])
    if (latex !== null) {
      parts.push(
        <span
          key={`${start}:${latex}`}
          className={displayMode ? 'live-markdown-table-math is-display' : 'live-markdown-table-math'}
          dangerouslySetInnerHTML={{ __html: renderMarkdownMath(latex, displayMode) }}
        />,
      )
    } else if (code !== undefined) {
      parts.push(<code key={`${start}:code:${code}`}>{code}</code>)
    }
    cursor = start + match[0].length
  }
  if (cursor < value.length) parts.push(value.slice(cursor))
  return parts.length ? parts : [value]
}

/**
 * An editable GFM table embedded inside Live Markdown's CodeMirror widget.
 * It owns cell-level edit state so the surrounding document never has to
 * temporarily fall back to raw Markdown source.
 */
export function LiveMarkdownTableEditor({
  table,
  readOnly,
  autoFocusCell = null,
  onCommit,
  onMeasure,
  findController,
  sourceRange,
  source,
}: LiveMarkdownTableEditorProps): React.ReactElement {
  const [activeCell, setActiveCell] = useState<LiveMarkdownTableCell | null>(autoFocusCell)
  const [findState, setFindState] = useState<LiveMarkdownFindState>(() => findController?.getState() ?? EMPTY_FIND_STATE)
  const [draft, setDraft] = useState(() => autoFocusCell ? cellValue(table, autoFocusCell) : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!autoFocusCell) return
    setActiveCell(autoFocusCell)
    setDraft(cellValue(table, autoFocusCell))
  }, [autoFocusCell, table])

  useEffect(() => {
    if (!findController) {
      setFindState(EMPTY_FIND_STATE)
      return
    }
    setFindState(findController.getState())
    return findController.subscribe(() => setFindState(findController.getState()))
  }, [findController])

  useEffect(() => {
    if (!activeCell) return
    inputRef.current?.focus()
    inputRef.current?.select()
    onMeasure()
  }, [activeCell, onMeasure])

  const activate = (cell: LiveMarkdownTableCell) => {
    if (readOnly) return
    if (activeCell?.row === cell.row && activeCell.column === cell.column) return
    if (activeCell) {
      const original = cellValue(table, activeCell)
      if (shouldCommitLiveMarkdownTableCell(original, draft)) {
        onCommit(updateLiveMarkdownTableCell(table, activeCell.row, activeCell.column, draft), cell)
        return
      }
      setActiveCell(cell)
      setDraft(cellValue(table, cell))
      return
    }
    setActiveCell(cell)
    setDraft(cellValue(table, cell))
  }

  const commit = (focusCell?: LiveMarkdownTableCell) => {
    if (!activeCell) return
    const original = cellValue(table, activeCell)
    if (!shouldCommitLiveMarkdownTableCell(original, draft)) {
      if (focusCell) {
        setActiveCell(focusCell)
        setDraft(cellValue(table, focusCell))
      } else {
        setActiveCell(null)
        setDraft('')
      }
      return
    }
    onCommit(updateLiveMarkdownTableCell(table, activeCell.row, activeCell.column, draft), focusCell)
    if (!focusCell) {
      setActiveCell(null)
      setDraft('')
    }
  }

  const cancel = () => {
    setActiveCell(null)
    setDraft('')
  }

  const nextCell = (from: LiveMarkdownTableCell, backwards: boolean): LiveMarkdownTableCell => nextLiveMarkdownTableCell(table, from, backwards)

  const renderCell = (row: number, column: number, header: boolean) => {
    const cell = { row, column }
    const value = cellValue(table, cell)
    const isActive = activeCell?.row === row && activeCell.column === column
    const matchesFind = doesLiveMarkdownTableCellMatch(value, findState.query, findState.options)
    const sourceCellRange = findLiveMarkdownTableCellSourceRange(source, sourceRange, cell)
    const hasActiveFindMatch = matchesFind
      && sourceCellRange !== null
      && findState.activeMatchFrom !== null
      && findState.activeMatchFrom >= sourceCellRange.from
      && findState.activeMatchFrom < sourceCellRange.to
    const Cell = header ? 'th' : 'td'
    const ariaLabel = `${header ? '表头' : '单元格'} ${row + 1}，${column + 1}`
    const className = [
      isActive && 'is-editing',
      matchesFind && 'live-markdown-table-find-match',
      hasActiveFindMatch && 'live-markdown-table-find-match-active',
    ].filter(Boolean).join(' ') || undefined

    return (
      <Cell key={column} className={className}>
        {isActive ? (
          <input
            ref={inputRef}
            className="live-markdown-table-input"
            aria-label={`编辑${ariaLabel}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => {
              if (event.relatedTarget instanceof HTMLElement && event.currentTarget.closest('table')?.contains(event.relatedTarget)) return
              commit()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              } else if (event.key === 'Tab') {
                event.preventDefault()
                commit(nextCell(cell, event.shiftKey))
              }
            }}
          />
        ) : readOnly ? (
          <span className="live-markdown-table-value">{renderInlineMath(value)}</span>
        ) : (
          <button
            type="button"
            className="live-markdown-table-cell-trigger"
            data-live-markdown-table-cell={`${row}:${column}`}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              activate(cell)
            }}
            onClick={(event) => event.preventDefault()}
          >
            <span className="live-markdown-table-value">{renderInlineMath(value)}</span>
          </button>
        )}
      </Cell>
    )
  }

  return (
    <div className="vault-markdown-table live-markdown-table-editor">
      <table aria-label="Markdown 表格">
        <thead><tr>{table.header.map((_, column) => renderCell(0, column, true))}</tr></thead>
        {table.rows.length > 0 && <tbody>{table.rows.map((_, row) => <tr key={row}>{table.header.map((_, column) => renderCell(row + 1, column, false))}</tr>)}</tbody>}
      </table>
    </div>
  )
}
