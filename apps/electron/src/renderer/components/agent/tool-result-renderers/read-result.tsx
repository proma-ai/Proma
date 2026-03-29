/**
 * Read 工具结果渲染器 — 语法高亮代码块
 *
 * 使用 Shiki 进行语法高亮，带行号显示
 */

import * as React from 'react'
import { highlightToTokens } from '@proma/core'
import type { HighlightToken } from '@proma/core'
import { cn } from '@/lib/utils'
import { inferLanguageFromPath } from '../tool-utils'
import { CollapsibleResult } from './collapsible-result'

interface ReadResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

/** 单行渲染（memoized） */
const TokenLine = React.memo(function TokenLine({
  tokens,
  lineNumber,
  fgColor,
}: {
  tokens: HighlightToken[]
  lineNumber: number
  fgColor: string
}): React.ReactElement {
  return (
    <div className="flex">
      <span className="shrink-0 w-10 text-right pr-3 select-none text-zinc-500 text-[11px]">
        {lineNumber}
      </span>
      <span className="flex-1 whitespace-pre-wrap break-all">
        {tokens.map((token, i) => (
          <span key={i} style={{ color: token.color ?? fgColor }}>
            {token.content}
          </span>
        ))}
      </span>
    </div>
  )
})

export function ReadResultRenderer({ result, isError, input }: ReadResultRendererProps): React.ReactElement {
  const filePath = typeof input.file_path === 'string'
    ? input.file_path
    : typeof input.filePath === 'string'
      ? (input.filePath as string)
      : ''

  const language = inferLanguageFromPath(filePath)
  const startLine = typeof input.offset === 'number' ? input.offset : 1

  // 高亮处理
  const highlighted = React.useMemo(() => {
    if (isError) return null
    return highlightToTokens({ code: result, language })
  }, [result, language, isError])

  const renderCode = React.useCallback((text: string): React.ReactNode => {
    if (isError) {
      return (
        <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
          {text}
        </pre>
      )
    }

    if (!highlighted) {
      // Fallback：无高亮
      const lines = text.split('\n')
      return (
        <div className={cn(
          'rounded-md font-mono text-[12px] leading-relaxed overflow-x-auto p-2',
          'bg-zinc-900 text-zinc-100 dark:bg-zinc-950',
        )}>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="shrink-0 w-10 text-right pr-3 select-none text-zinc-500 text-[11px]">
                {startLine + i}
              </span>
              <span className="flex-1 whitespace-pre-wrap break-all">{line || '\u200B'}</span>
            </div>
          ))}
        </div>
      )
    }

    // 如果内容被截断（CollapsibleResult 传入的 text 可能少于 result），
    // 则只渲染对应行数的 token
    const textLineCount = text.split('\n').length
    const linesToRender = highlighted.lines.slice(0, textLineCount)

    return (
      <div
        className="rounded-md font-mono text-[12px] leading-relaxed overflow-x-auto p-2"
        style={{ backgroundColor: highlighted.bgColor }}
      >
        {linesToRender.map((tokens, i) => (
          <TokenLine
            key={startLine + i}
            tokens={tokens}
            lineNumber={startLine + i}
            fgColor={highlighted.fgColor}
          />
        ))}
      </div>
    )
  }, [highlighted, isError, startLine])

  return (
    <CollapsibleResult
      content={result}
      renderContent={renderCode}
    />
  )
}
