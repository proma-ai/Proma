/**
 * Write 工具结果渲染器 — @pierre/diffs 版本
 *
 * 新建文件时以 pierre diff 显示全部新增行（old 为空）。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MultiFileDiff } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import { resolvedThemeAtom } from '@/atoms/theme'
import { FilePathChip } from '@/components/ai-elements/file-path-chip'
import { PIERRE_DIFF_CSS } from './pierre-styles'

function cheapHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

interface WriteResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

export function WriteResultRenderer({ result, isError, input }: WriteResultRendererProps): React.ReactElement {
  const theme = useAtomValue(resolvedThemeAtom)
  const content = typeof input.content === 'string' ? input.content : ''
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''

  const oldFile = React.useMemo<FileContents>(() => ({
    name: filePath || 'new-file',
    contents: '',
    cacheKey: `old:${filePath}:0`,
  }), [filePath])

  const newFile = React.useMemo<FileContents>(() => ({
    name: filePath || 'new-file',
    contents: content,
    cacheKey: `new:${filePath}:${cheapHash(content)}`,
  }), [filePath, content])

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

  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  if (!content) {
    return (
      <div className="text-[12px] text-muted-foreground flex items-center gap-1">
        已写入 {filePath ? <FilePathChip filePath={filePath} /> : <span className="font-mono text-foreground/70">文件</span>}
      </div>
    )
  }

  return (
    <div className="rounded-md overflow-x-hidden overflow-y-auto bg-content-area max-h-[400px]">
      <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} />
    </div>
  )
}
