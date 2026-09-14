import * as React from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { liveMarkdownTableCellDraft, renderLiveMarkdownTableInline } from './live-markdown-table-inline'
import {
  type LiveMarkdownTable,
  deleteLiveMarkdownTableColumn,
  deleteLiveMarkdownTableRow,
  insertLiveMarkdownTableColumn,
  insertLiveMarkdownTableRow,
  liveMarkdownTableCellKeyAction,
  nextLiveMarkdownTableCell,
  shouldCommitLiveMarkdownTableCell,
  updateLiveMarkdownTableCell,
} from './live-markdown-table'
import type { LiveMarkdownFindController, LiveMarkdownFindOptions, LiveMarkdownFindState } from './LiveMarkdownPreview'

const { useEffect, useLayoutEffect, useRef, useState } = React
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface LiveMarkdownTableCell {
  row: number
  column: number
}

interface LiveMarkdownTableEditorProps {
  table: LiveMarkdownTable
  readOnly: boolean
  autoFocusCell?: LiveMarkdownTableCell | null
  onCommit: (table: LiveMarkdownTable, focusCell?: LiveMarkdownTableCell) => void
  onDelete: () => void
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
  onDelete,
  onMeasure,
  findController,
  sourceRange,
  source,
}: LiveMarkdownTableEditorProps): React.ReactElement {
  const [activeCell, setActiveCell] = useState<LiveMarkdownTableCell | null>(autoFocusCell)
  const [findState, setFindState] = useState<LiveMarkdownFindState>(() => findController?.getState() ?? EMPTY_FIND_STATE)
  const [draft, setDraft] = useState(() => autoFocusCell ? liveMarkdownTableCellDraft(cellValue(table, autoFocusCell)) : '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const minimumHeightRef = useRef(0)
  // CodeMirror 替换 widget 在 dispatch 同步卸载 textarea，会立即触发 blur。
  // 该期间禁止再次提交，避免 EditorView.update 重入。
  const isDispatchingTableChangeRef = useRef(false)

  const dispatchTableCommit = (nextTable: LiveMarkdownTable, focusCell?: LiveMarkdownTableCell) => {
    if (isDispatchingTableChangeRef.current) return
    isDispatchingTableChangeRef.current = true
    try {
      onCommit(nextTable, focusCell)
    } finally {
      // TableWidget 会在本次 CodeMirror transaction 内排队卸载旧 React root。
      // 让它先完成 textarea blur，避免 blur 回调在 update 仍未结束时二次 dispatch。
      queueMicrotask(() => { isDispatchingTableChangeRef.current = false })
    }
  }

  const dispatchTableDelete = () => {
    if (isDispatchingTableChangeRef.current) return
    isDispatchingTableChangeRef.current = true
    try {
      onDelete()
    } finally {
      queueMicrotask(() => { isDispatchingTableChangeRef.current = false })
    }
  }

  useEffect(() => {
    if (!autoFocusCell) return
    setActiveCell(autoFocusCell)
    setDraft(liveMarkdownTableCellDraft(cellValue(table, autoFocusCell)))
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

  // 首次激活、输入和列宽变化时都重新测量，长文本无需在单行框内横向滚动。
  useIsomorphicLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    const resize = () => {
      input.style.height = '0px'
      input.style.height = `${Math.max(input.scrollHeight, minimumHeightRef.current)}px`
      onMeasure()
    }
    resize()
    let width = input.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const nextWidth = input.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      minimumHeightRef.current = 0
      resize()
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [activeCell, draft, onMeasure])

  const activate = (cell: LiveMarkdownTableCell, element: HTMLButtonElement) => {
    if (readOnly) return
    if (activeCell?.row === cell.row && activeCell.column === cell.column) return
    minimumHeightRef.current = element.getBoundingClientRect().height
    if (activeCell) {
      const original = liveMarkdownTableCellDraft(cellValue(table, activeCell))
      if (shouldCommitLiveMarkdownTableCell(original, draft)) {
        dispatchTableCommit(updateLiveMarkdownTableCell(table, activeCell.row, activeCell.column, draft), cell)
        return
      }
      setActiveCell(cell)
      setDraft(liveMarkdownTableCellDraft(cellValue(table, cell)))
      return
    }
    setActiveCell(cell)
    setDraft(liveMarkdownTableCellDraft(cellValue(table, cell)))
  }

  const commit = (focusCell?: LiveMarkdownTableCell) => {
    if (!activeCell || isDispatchingTableChangeRef.current) return
    if (focusCell) {
      const target = inputRef.current?.closest('table')?.querySelector<HTMLButtonElement>(
        `[data-live-markdown-table-cell="${focusCell.row}:${focusCell.column}"]`,
      )
      minimumHeightRef.current = target?.getBoundingClientRect().height ?? 0
    }
    const original = liveMarkdownTableCellDraft(cellValue(table, activeCell))
    if (!shouldCommitLiveMarkdownTableCell(original, draft)) {
      if (focusCell) {
        setActiveCell(focusCell)
        setDraft(liveMarkdownTableCellDraft(cellValue(table, focusCell)))
      } else {
        setActiveCell(null)
        setDraft('')
      }
      return
    }
    dispatchTableCommit(updateLiveMarkdownTableCell(table, activeCell.row, activeCell.column, draft), focusCell)
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

  const tableWithDraft = (): LiveMarkdownTable => {
    if (!activeCell) return table
    return updateLiveMarkdownTableCell(table, activeCell.row, activeCell.column, draft)
  }

  const applyTableChange = (
    change: (currentTable: LiveMarkdownTable) => LiveMarkdownTable,
    focusCell?: LiveMarkdownTableCell,
  ) => {
    if (isDispatchingTableChangeRef.current) return
    dispatchTableCommit(change(tableWithDraft()), focusCell)
    setActiveCell(null)
    setDraft('')
  }

  const removeTable = () => {
    if (isDispatchingTableChangeRef.current) return
    setActiveCell(null)
    setDraft('')
    dispatchTableDelete()
  }

  const renderCell = (row: number, column: number, header: boolean) => {
    const cell = { row, column }
    const value = cellValue(table, cell)
    const isActive = !readOnly && activeCell?.row === row && activeCell.column === column
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

    const cellContent = (
      <Cell className={className}>
        {isActive ? (
          <textarea
            ref={inputRef}
            className="live-markdown-table-input"
            aria-label={`编辑${ariaLabel}`}
            rows={1}
            title="Enter 保存，Shift+Enter 换行，Tab 切换单元格，Esc 取消"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => {
              const relatedTarget = event.relatedTarget
              if (relatedTarget instanceof HTMLElement && (
                event.currentTarget.closest('table')?.contains(relatedTarget)
                || relatedTarget.closest('[role="menu"]')
              )) return
              commit()
            }}
            onKeyDown={(event) => {
              const action = liveMarkdownTableCellKeyAction(
                event.key,
                event.shiftKey,
                event.nativeEvent.isComposing,
                event.keyCode,
              )
              if (action === 'commit') {
                event.preventDefault()
                commit()
              } else if (action === 'cancel') {
                event.preventDefault()
                cancel()
              } else if (action === 'next' || action === 'previous') {
                event.preventDefault()
                commit(nextCell(cell, action === 'previous'))
              }
            }}
          />
        ) : readOnly ? (
          <span className="live-markdown-table-value" dangerouslySetInnerHTML={{ __html: renderLiveMarkdownTableInline(value) }} />
        ) : (
          <button
            type="button"
            className="live-markdown-table-cell-trigger"
            data-live-markdown-table-cell={`${row}:${column}`}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              activate(cell, event.currentTarget)
            }}
            onClick={(event) => {
              event.preventDefault()
              if (event.detail === 0) activate(cell, event.currentTarget)
            }}
          >
            <span className="live-markdown-table-value" dangerouslySetInnerHTML={{ __html: renderLiveMarkdownTableInline(value) }} />
          </button>
        )}
      </Cell>
    )

    if (readOnly) return React.cloneElement(cellContent, { key: `${row}:${column}` })

    const bodyRowIndex = row - 1
    const hasMinimumColumns = table.header.length <= 2
    const deleteRowFocus = table.rows.length === 1
      ? { row: 0, column }
      : { row: Math.min(row, table.rows.length - 1), column }
    const deleteColumnFocus = { row, column: Math.min(column, table.header.length - 2) }

    return (
      <ContextMenu key={`${row}:${column}`}>
        <ContextMenuTrigger asChild>{cellContent}</ContextMenuTrigger>
        <ContextMenuContent className="z-[9999] min-w-48 p-0.5">
          {!header && (
            <ContextMenuItem onSelect={() => applyTableChange(
              (currentTable) => insertLiveMarkdownTableRow(currentTable, bodyRowIndex),
              { row, column },
            )}
            >
              在上方插入行
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => applyTableChange(
            (currentTable) => insertLiveMarkdownTableRow(currentTable, header ? 0 : bodyRowIndex + 1),
            { row: header ? 1 : row + 1, column },
          )}
          >
            在下方插入行
          </ContextMenuItem>
          {!header && (
            <ContextMenuItem
              className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
              onSelect={() => applyTableChange(
                (currentTable) => deleteLiveMarkdownTableRow(currentTable, bodyRowIndex),
                deleteRowFocus,
              )}
            >
              删除本行
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => applyTableChange(
            (currentTable) => insertLiveMarkdownTableColumn(currentTable, column),
            { row, column },
          )}
          >
            在左侧插入列
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => applyTableChange(
            (currentTable) => insertLiveMarkdownTableColumn(currentTable, column + 1),
            { row, column: column + 1 },
          )}
          >
            在右侧插入列
          </ContextMenuItem>
          <ContextMenuItem
            disabled={hasMinimumColumns}
            className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
            onSelect={() => applyTableChange(
              (currentTable) => deleteLiveMarkdownTableColumn(currentTable, column),
              deleteColumnFocus,
            )}
          >
            删除本列
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
            onSelect={removeTable}
          >
            删除表格
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <div className="vault-markdown-table live-markdown-table-editor">
      {!readOnly && <div className="live-markdown-table-editor-hint" aria-hidden="true">点击编辑、右键操作更多</div>}
      <table aria-label="Markdown 表格">
        <thead><tr>{table.header.map((_, column) => renderCell(0, column, true))}</tr></thead>
        {table.rows.length > 0 && <tbody>{table.rows.map((_, row) => <tr key={row}>{table.header.map((_, column) => renderCell(row + 1, column, false))}</tr>)}</tbody>}
      </table>
    </div>
  )
}
