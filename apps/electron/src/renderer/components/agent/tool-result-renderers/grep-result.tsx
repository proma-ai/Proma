/**
 * Grep 工具结果渲染器 — 搜索结果列表
 *
 * 解析 grep 输出格式（文件路径:行号:内容），
 * 按文件分组显示，匹配词高亮
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { FileTypeIcon } from '@/components/file-browser'
import { CollapsibleResult } from './collapsible-result'

interface GrepResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

interface GrepMatch {
  file: string
  line: number
  content: string
}

interface GrepFileGroup {
  file: string
  matches: GrepMatch[]
}

/** 解析 grep 输出为结构化数据 */
function parseGrepOutput(text: string): GrepFileGroup[] | null {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length === 0) return null

  const matches: GrepMatch[] = []
  for (const line of lines) {
    // 格式: filepath:lineNo:content 或 filepath:lineNo-content
    const match = line.match(/^(.+?):(\d+)[:-](.*)$/)
    if (match && match[1] && match[2] && match[3] !== undefined) {
      matches.push({ file: match[1], line: parseInt(match[2], 10), content: match[3] })
    }
  }

  if (matches.length === 0) return null

  // 按文件分组
  const groups = new Map<string, GrepMatch[]>()
  for (const m of matches) {
    const existing = groups.get(m.file)
    if (existing) {
      existing.push(m)
    } else {
      groups.set(m.file, [m])
    }
  }

  return Array.from(groups.entries()).map(([file, fileMatches]) => ({ file, matches: fileMatches }))
}

/** 高亮搜索词 */
function highlightPattern(text: string, pattern: string): React.ReactNode {
  if (!pattern) return text
  try {
    const regex = new RegExp(`(${pattern})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i} className="bg-yellow-300/30 text-yellow-200 rounded-sm px-0.5">{part}</mark>
        : part,
    )
  } catch {
    return text
  }
}

export function GrepResultRenderer({ result, isError, input }: GrepResultRendererProps): React.ReactElement {
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''

  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  const groups = React.useMemo(() => parseGrepOutput(result), [result])

  // 无法解析时 fallback 到纯文本
  if (!groups) {
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

  const totalMatches = groups.reduce((sum, g) => sum + g.matches.length, 0)

  const renderGroups = React.useCallback((text: string): React.ReactNode => {
    // 根据 text 长度决定显示多少（CollapsibleResult 会截断）
    const visibleLines = text.split('\n').length

    return (
      <div className="space-y-2">
        {/* 统计 */}
        <div className="text-[11px] text-muted-foreground/60">
          {totalMatches} 个匹配，{groups.length} 个文件
        </div>

        {groups.map((group) => (
          <div key={group.file} className="rounded-md overflow-hidden bg-zinc-900 dark:bg-zinc-950">
            {/* 文件头 */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/50 text-[11px]">
              <FileTypeIcon name={group.file.split('/').pop() || group.file} isDirectory={false} size={12} />
              <span className="font-mono text-zinc-300">{group.file}</span>
              <span className="text-zinc-500">({group.matches.length})</span>
            </div>
            {/* 匹配行 */}
            <div className="font-mono text-[12px]">
              {group.matches.map((m, i) => (
                <div key={i} className="flex px-3 py-0.5 hover:bg-zinc-800/30">
                  <span className="shrink-0 w-10 text-right pr-3 select-none text-zinc-500 text-[11px]">
                    {m.line}
                  </span>
                  <span className={cn('flex-1 whitespace-pre-wrap break-all text-zinc-200')}>
                    {highlightPattern(m.content, pattern)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }, [groups, pattern, totalMatches])

  return (
    <CollapsibleResult
      content={result}
      renderContent={renderGroups}
    />
  )
}
