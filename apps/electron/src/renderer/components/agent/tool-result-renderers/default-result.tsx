/**
 * 默认工具结果渲染器 — Key-Value 表格 / 纯文本
 *
 * 用于未匹配到专属渲染器的工具（包括 MCP 工具）
 */

import * as React from 'react'
import { CollapsibleResult } from './collapsible-result'

interface DefaultResultRendererProps {
  result: string
  isError: boolean
}

/** 尝试将结果解析为 key-value 对 */
function tryParseKeyValue(text: string): Array<{ key: string; value: string }> | null {
  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      }))
    }
  } catch {
    // 非 JSON
  }
  return null
}

export function DefaultResultRenderer({ result, isError }: DefaultResultRendererProps): React.ReactElement {
  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  const keyValues = React.useMemo(() => tryParseKeyValue(result), [result])

  // Key-Value 表格
  if (keyValues && keyValues.length > 0) {
    return (
      <div className="rounded-md bg-muted/20 overflow-hidden">
        <table className="w-full text-[12px]">
          <tbody>
            {keyValues.map(({ key, value }, i) => (
              <tr key={i} className="border-b border-border/20 last:border-b-0">
                <td className="px-3 py-1.5 text-muted-foreground/60 font-mono whitespace-nowrap align-top">
                  {key}
                </td>
                <td className="px-3 py-1.5 text-foreground/70 font-mono whitespace-pre-wrap break-all">
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // 纯文本 fallback
  return (
    <CollapsibleResult
      content={result}
      renderContent={(text) => (
        <pre className="rounded-md p-3 text-[12px] font-mono text-foreground/60 bg-muted/30 whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto">
          {text}
        </pre>
      )}
    />
  )
}
