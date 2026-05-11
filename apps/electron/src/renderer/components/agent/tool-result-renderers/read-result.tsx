/**
 * Read 工具结果渲染器 — @pierre/diffs File 版本
 *
 * 使用 @pierre/diffs 的 File 组件渲染代码预览，
 * 带 Shiki 语法高亮、行号、与 diff 视图一致的主题风格。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { File as PierreFile } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import { resolvedThemeAtom } from '@/atoms/theme'
import { CollapsibleResult } from './collapsible-result'
import { createPierreFileCSS } from './pierre-styles'

function cheapHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

interface ReadResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

const NUMBERED_READ_LINE_RE = /^\s*(\d+)(?:\t|\u2192\s?|\s+)(.*)$/

interface NormalizedReadContent {
  contents: string
  lineNumberStart: number
  maxLineNumber: number
}

function getInputStartLine(input: Record<string, unknown>): number {
  const candidate =
    input.offset ??
    input.start_line ??
    input.startLine ??
    input.line_number ??
    input.lineNumber
  const lineNumber =
    typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string'
        ? Number(candidate)
        : Number.NaN

  return Number.isFinite(lineNumber) ? Math.max(1, Math.floor(lineNumber)) : 1
}

function parseCatNumberedContent(text: string, expectedStartLine: number): NormalizedReadContent | null {
  const lines = text.split('\n')
  const strippedLines: string[] = []
  let firstLineNumber: number | null = null
  let previousLineNumber: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line === '' && i === lines.length - 1) {
      strippedLines.push('')
      continue
    }

    const match = NUMBERED_READ_LINE_RE.exec(line)
    if (!match) return null

    const lineNumber = Number(match[1] ?? '')
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) return null
    if (firstLineNumber === null) firstLineNumber = lineNumber
    if (previousLineNumber !== null && lineNumber !== previousLineNumber + 1) return null

    strippedLines.push(match[2] ?? '')
    previousLineNumber = lineNumber
  }

  if (firstLineNumber === null) return null

  const lineNumberOffset =
    firstLineNumber === 1 && expectedStartLine > 1
      ? expectedStartLine - firstLineNumber
      : 0

  return {
    contents: strippedLines.join('\n'),
    lineNumberStart: firstLineNumber + lineNumberOffset,
    maxLineNumber: (previousLineNumber ?? firstLineNumber) + lineNumberOffset,
  }
}

function normalizeReadContent(text: string, startLine: number): NormalizedReadContent {
  const catNumbered = parseCatNumberedContent(text, startLine)
  if (catNumbered) return catNumbered

  const lineCount = text === '' ? 1 : text.split('\n').length
  return {
    contents: text,
    lineNumberStart: startLine,
    maxLineNumber: startLine + Math.max(0, lineCount - 1),
  }
}

export function ReadResultRenderer({ result, isError, input }: ReadResultRendererProps): React.ReactElement {
  const theme = useAtomValue(resolvedThemeAtom)
  const filePath = typeof input.file_path === 'string'
    ? input.file_path
    : typeof input.filePath === 'string'
      ? (input.filePath as string)
      : ''

  const inputStartLine = getInputStartLine(input)

  // Claude Agent SDK Read 工具返回带行号的内容（如 "    1\tcontent" / "1 content"）。
  // 渲染前剥离行号避免双行号，再用 unsafeCSS 把 Pierre gutter 调整回真实起始行。
  const renderCode = React.useCallback((text: string): React.ReactNode => {
    if (isError) {
      return (
        <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
          {text}
        </pre>
      )
    }

    const normalized = normalizeReadContent(text, inputStartLine)
    const file: FileContents = {
      name: filePath || 'file',
      contents: normalized.contents,
      cacheKey: `read:${filePath}:${normalized.lineNumberStart}:${cheapHash(normalized.contents)}`,
    }
    const options = {
      theme: { dark: 'one-dark-pro' as const, light: 'one-light' as const },
      disableFileHeader: true,
      overflow: 'scroll' as const,
      themeType: theme as 'light' | 'dark' | 'system',
      unsafeCSS: createPierreFileCSS(normalized.lineNumberStart, normalized.maxLineNumber),
    }

    return (
      <div className="rounded-md overflow-x-hidden overflow-y-auto bg-content-area max-h-[400px]">
        <PierreFile file={file} options={options} />
      </div>
    )
  }, [isError, filePath, inputStartLine, theme])

  return (
    <CollapsibleResult
      content={result}
      renderContent={renderCode}
    />
  )
}
