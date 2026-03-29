/**
 * Edit 工具结果渲染器 — Diff 视图
 *
 * 显示 old_string → new_string 的差异，
 * 删除行红色背景，新增行绿色背景
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

interface EditResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

export function EditResultRenderer({ result, isError, input }: EditResultRendererProps): React.ReactElement {
  const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input.new_string === 'string' ? input.new_string : ''

  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  // 无 diff 数据时显示成功消息
  if (!oldStr && !newStr) {
    return (
      <div className="text-[12px] text-muted-foreground">
        {result || '编辑成功'}
      </div>
    )
  }

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return (
    <div className="rounded-md font-mono text-[12px] leading-relaxed overflow-x-auto bg-zinc-900 dark:bg-zinc-950">
      {/* 删除行 */}
      {oldLines.length > 0 && oldStr && (
        <div>
          {oldLines.map((line, i) => (
            <div
              key={`del-${i}`}
              className="flex bg-red-500/10"
            >
              <span className="shrink-0 w-10 text-right pr-3 select-none text-red-400/60 text-[11px]">
                -
              </span>
              <span className={cn('flex-1 whitespace-pre-wrap break-all text-red-300')}>
                {line || '\u200B'}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* 新增行 */}
      {newLines.length > 0 && newStr && (
        <div>
          {newLines.map((line, i) => (
            <div
              key={`add-${i}`}
              className="flex bg-green-500/10"
            >
              <span className="shrink-0 w-10 text-right pr-3 select-none text-green-400/60 text-[11px]">
                +
              </span>
              <span className={cn('flex-1 whitespace-pre-wrap break-all text-green-300')}>
                {line || '\u200B'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
