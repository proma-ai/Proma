/**
 * Write 工具结果渲染器 — 内容视图
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { FilePathChip } from '@/components/ai-elements/file-path-chip'

interface WriteResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

export function WriteResultRenderer({ result, isError, input }: WriteResultRendererProps): React.ReactElement {
  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  const content = typeof input.content === 'string' ? input.content : ''

  if (!content) {
    const filePath = typeof input.file_path === 'string' ? input.file_path : ''
    return (
      <div className="text-[12px] text-muted-foreground flex items-center gap-1">
        已写入 {filePath ? <FilePathChip filePath={filePath} /> : <span className="font-mono text-foreground/70">文件</span>}
      </div>
    )
  }

  const lines = content.split('\n')

  return (
    <div className="rounded-md font-mono text-[12px] leading-relaxed overflow-x-auto bg-zinc-900 dark:bg-zinc-950">
      {lines.map((line, i) => (
        <div key={i} className="flex bg-green-500/10">
          <span className="shrink-0 w-10 text-right pr-3 select-none text-green-400/60 text-[11px]">
            +
          </span>
          <span className={cn('flex-1 whitespace-pre-wrap break-all text-green-300')}>
            {line || '\u200B'}
          </span>
        </div>
      ))}
    </div>
  )
}
