/**
 * WebSearch 工具结果渲染器 — 搜索结果卡片
 */

import * as React from 'react'
import { Globe } from 'lucide-react'
import { CollapsibleResult } from './collapsible-result'

interface WebSearchResultRendererProps {
  result: string
  isError: boolean
}

interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** 尝试解析搜索结果（支持多种常见格式） */
function parseSearchResults(text: string): SearchResult[] | null {
  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item: Record<string, unknown>) => item.title || item.url)
        .map((item: Record<string, unknown>) => ({
          title: String(item.title ?? ''),
          url: String(item.url ?? item.link ?? ''),
          snippet: String(item.snippet ?? item.description ?? item.content ?? ''),
        }))
    }
  } catch {
    // 非 JSON，尝试文本解析
  }

  // 尝试解析常见的文本格式（标题 + URL + 摘要，按段落分隔）
  const blocks = text.split(/\n{2,}/).filter(Boolean)
  if (blocks.length < 2) return null

  const results: SearchResult[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    if (lines.length >= 2) {
      const urlLine = lines.find((l) => l.match(/https?:\/\//))
      const titleLine = lines.find((l) => !l.match(/https?:\/\//) && l.length > 0)
      if (urlLine && titleLine) {
        const urlMatch = urlLine.match(/(https?:\/\/\S+)/)
        results.push({
          title: titleLine.replace(/^\d+\.\s*/, '').replace(/\*\*/g, ''),
          url: urlMatch?.[1] ?? urlLine,
          snippet: lines.filter((l) => l !== urlLine && l !== titleLine).join(' ').slice(0, 200),
        })
      }
    }
  }

  return results.length > 0 ? results : null
}

export function WebSearchResultRenderer({ result, isError }: WebSearchResultRendererProps): React.ReactElement {
  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  const searchResults = React.useMemo(() => parseSearchResults(result), [result])

  // 无法解析为搜索结果时 fallback
  if (!searchResults) {
    return (
      <CollapsibleResult
        content={result}
        renderContent={(text) => (
          <pre className="rounded-md p-3 text-[12px] font-mono text-foreground/60 bg-muted/30 whitespace-pre-wrap break-all overflow-x-auto">
            {text}
          </pre>
        )}
      />
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground/60">
        {searchResults.length} 条结果
      </div>
      {searchResults.map((item, i) => (
        <div key={i} className="rounded-md bg-muted/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5">
            <Globe className="size-3 shrink-0 text-muted-foreground/50" />
            <span className="text-[12px] font-medium text-foreground/80 truncate">
              {item.title}
            </span>
          </div>
          {item.url && (
            <div className="text-[11px] text-primary/60 font-mono truncate">
              {item.url}
            </div>
          )}
          {item.snippet && (
            <div className="text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-2">
              {item.snippet}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
