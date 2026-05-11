/**
 * Edit 工具结果渲染器 — @pierre/diffs 版本
 *
 * 使用 @pierre/diffs MultiFileDiff 渲染 old_string → new_string 的差异，
 * 带 Shiki 语法高亮、行号，固定使用 unified 视图。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { FileDiff } from '@pierre/diffs/react'
import { parseDiffFromFile, type FileContents, type FileDiffMetadata } from '@pierre/diffs'
import { resolvedThemeAtom } from '@/atoms/theme'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { PIERRE_DIFF_CSS } from './pierre-styles'

function cheapHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

interface EditResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
  basePath?: string
}

const HUNK_HEADER_RE = /^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)?( @@.*)$/

function getExplicitStartLine(input: Record<string, unknown>): number | null {
  const value = input.offset ?? input.start_line ?? input.startLine ?? input.line_number ?? input.lineNumber
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : null
}

function uniqueIndexOf(haystack: string, needle: string): number | null {
  if (!needle) return null
  const first = haystack.indexOf(needle)
  if (first === -1) return null
  return haystack.indexOf(needle, first + needle.length) === -1 ? first : null
}

function lineNumberAtIndex(text: string, index: number): number {
  let lineNumber = 1
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) lineNumber++
  }
  return lineNumber
}

function findEditedSnippetStartLine(fileContents: string, oldStr: string, newStr: string): number | null {
  const normalizedContents = fileContents.replace(/\r\n?/g, '\n')
  const normalizedNew = newStr.replace(/\r\n?/g, '\n')
  const normalizedOld = oldStr.replace(/\r\n?/g, '\n')
  const matchIndex = uniqueIndexOf(normalizedContents, normalizedNew)
    ?? uniqueIndexOf(normalizedContents, normalizedOld)
  return matchIndex === null ? null : lineNumberAtIndex(normalizedContents, matchIndex)
}

function offsetHunkSpecs(hunkSpecs: string | undefined, offset: number): string | undefined {
  if (!hunkSpecs) return hunkSpecs
  return hunkSpecs.replace(
    HUNK_HEADER_RE,
    (_match, deletionStart: string, deletionCount: string | undefined, additionStart: string, additionCount: string | undefined, suffix: string) => (
      `@@ -${Number(deletionStart) + offset}${deletionCount ?? ''} +${Number(additionStart) + offset}${additionCount ?? ''}${suffix}`
    ),
  )
}

function offsetFileDiffLineNumbers(fileDiff: FileDiffMetadata, lineNumberStart: number | null): FileDiffMetadata {
  const offset = lineNumberStart === null ? 0 : Math.max(0, Math.floor(lineNumberStart) - 1)
  if (offset === 0) return fileDiff
  return {
    ...fileDiff,
    hunks: fileDiff.hunks.map((hunk) => ({
      ...hunk,
      additionStart: hunk.additionStart + offset,
      deletionStart: hunk.deletionStart + offset,
      hunkSpecs: offsetHunkSpecs(hunk.hunkSpecs, offset),
    })),
  }
}

export function EditResultRenderer({ result, isError, input, basePath }: EditResultRendererProps): React.ReactElement {
  const theme = useAtomValue(resolvedThemeAtom)
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input.new_string === 'string' ? input.new_string : ''
  const filePath = typeof input.file_path === 'string' ? input.file_path : 'file'
  const explicitStartLine = getExplicitStartLine(input)
  const [lineNumberStart, setLineNumberStart] = React.useState<number | null>(explicitStartLine)

  const oldFile = React.useMemo<FileContents>(() => ({
    name: filePath,
    contents: oldStr,
    cacheKey: `old:${filePath}:${cheapHash(oldStr)}`,
  }), [filePath, oldStr])

  const newFile = React.useMemo<FileContents>(() => ({
    name: filePath,
    contents: newStr,
    cacheKey: `new:${filePath}:${cheapHash(newStr)}`,
  }), [filePath, newStr])

  const options = React.useMemo(() => ({
    diffStyle: 'unified' as const,
    theme: { dark: 'one-dark-pro' as const, light: 'one-light' as const },
    disableFileHeader: true,
    diffIndicators: 'bars' as const,
    hunkSeparators: 'line-info' as const,
    lineDiffType: 'none' as const,
    overflow: 'scroll' as const,
    themeType: theme as 'light' | 'dark' | 'system',
    unsafeCSS: PIERRE_DIFF_CSS,
  }), [theme])

  React.useEffect(() => {
    if (explicitStartLine !== null) {
      setLineNumberStart(explicitStartLine)
      return
    }

    if (isError || !filePath || (!oldStr && !newStr)) {
      setLineNumberStart(null)
      return
    }

    let cancelled = false
    const candidateBasePaths = basePath ? [basePath] : undefined
    window.electronAPI.resolveAndReadFile(filePath, {
      sessionId: sessionId ?? undefined,
      candidateBasePaths,
    })
      .then((file) => {
        if (cancelled) return
        setLineNumberStart(file ? findEditedSnippetStartLine(file.content, oldStr, newStr) : null)
      })
      .catch(() => {
        if (!cancelled) setLineNumberStart(null)
      })

    return () => {
      cancelled = true
    }
  }, [basePath, explicitStartLine, filePath, isError, newStr, oldStr, sessionId])

  const fileDiff = React.useMemo<FileDiffMetadata | null>(() => {
    if ((!oldStr && !newStr) || oldStr === newStr) return null
    try {
      return offsetFileDiffLineNumbers(parseDiffFromFile(oldFile, newFile), lineNumberStart)
    } catch {
      return null
    }
  }, [lineNumberStart, newFile, newStr, oldFile, oldStr])

  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  if (!oldStr && !newStr) {
    return (
      <div className="text-[12px] text-muted-foreground">
        {result || '编辑成功'}
      </div>
    )
  }

  if (!fileDiff) {
    return (
      <div className="text-[12px] text-muted-foreground">
        {result || '编辑成功'}
      </div>
    )
  }

  return (
    <div className="rounded-md overflow-x-hidden overflow-y-auto bg-content-area max-h-[400px]">
      <FileDiff fileDiff={fileDiff} options={options} />
    </div>
  )
}
