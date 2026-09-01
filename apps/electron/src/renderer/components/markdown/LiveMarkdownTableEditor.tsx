import * as React from 'react'
import { renderMarkdownMath } from '@/lib/markdown-math'
import {
  type LiveMarkdownTable,
  isLikelyLiveMarkdownLatex,
  nextLiveMarkdownTableCell,
  shouldCommitLiveMarkdownTableCell,
  updateLiveMarkdownTableCell,
} from './live-markdown-table'

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
}

function cellValue(table: LiveMarkdownTable, { row, column }: LiveMarkdownTableCell): string {
  return row === 0 ? table.header[column] ?? '' : table.rows[row - 1]?.[column] ?? ''
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
}: LiveMarkdownTableEditorProps): React.ReactElement {
  const [activeCell, setActiveCell] = useState<LiveMarkdownTableCell | null>(autoFocusCell)
  const [draft, setDraft] = useState(() => autoFocusCell ? cellValue(table, autoFocusCell) : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!autoFocusCell) return
    setActiveCell(autoFocusCell)
    setDraft(cellValue(table, autoFocusCell))
  }, [autoFocusCell, table])

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
    const Cell = header ? 'th' : 'td'
    const ariaLabel = `${header ? '表头' : '单元格'} ${row + 1}，${column + 1}`

    return (
      <Cell key={column} className={isActive ? 'is-editing' : undefined}>
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
