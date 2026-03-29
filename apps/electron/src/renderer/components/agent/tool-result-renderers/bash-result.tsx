/**
 * Bash 工具结果渲染器 — 终端风格
 *
 * 深色背景、等宽字体、stderr 红色高亮
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { CollapsibleResult } from './collapsible-result'

interface BashResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

/** 简单检测 stderr 行（常见模式） */
function classifyLine(line: string): 'stderr' | 'normal' {
  const lower = line.toLowerCase()
  if (
    lower.startsWith('error:') ||
    lower.startsWith('error ') ||
    lower.startsWith('fatal:') ||
    lower.startsWith('warning:') ||
    lower.includes('traceback') ||
    lower.includes('exception') ||
    lower.startsWith('stderr:')
  ) {
    return 'stderr'
  }
  return 'normal'
}

export function BashResultRenderer({ result, isError, input }: BashResultRendererProps): React.ReactElement {
  const command = typeof input.command === 'string' ? input.command : undefined

  const renderTerminal = React.useCallback((text: string): React.ReactNode => {
    const lines = text.split('\n')
    return (
      <div className={cn(
        'rounded-md font-mono text-[12px] leading-relaxed overflow-x-auto',
        'bg-zinc-900 text-zinc-100 dark:bg-zinc-950',
        'p-3',
      )}>
        {/* 命令回显 */}
        {command && (
          <div className="text-zinc-500 mb-2 select-none">
            <span className="text-green-400">$</span> {command}
          </div>
        )}
        {/* 输出行 */}
        {lines.map((line, i) => {
          const type = isError ? 'stderr' : classifyLine(line)
          return (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all min-h-[1.25em]',
                type === 'stderr' && 'text-red-400',
              )}
            >
              {line || '\u200B'}
            </div>
          )
        })}
      </div>
    )
  }, [command, isError])

  return (
    <CollapsibleResult
      content={result}
      renderContent={renderTerminal}
    />
  )
}
