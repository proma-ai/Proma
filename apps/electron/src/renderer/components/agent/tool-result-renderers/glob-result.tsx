/**
 * Glob 工具结果渲染器 — 紧凑文件列表
 */

import * as React from 'react'
import { CollapsibleResult } from './collapsible-result'
import { FileTypeIcon } from '@/components/file-browser'

interface GlobResultRendererProps {
  result: string
  isError: boolean
}

export function GlobResultRenderer({ result, isError }: GlobResultRendererProps): React.ReactElement {
  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  const files = React.useMemo(() => result.split('\n').filter(Boolean), [result])

  const renderList = React.useCallback((text: string): React.ReactNode => {
    const visibleFiles = text.split('\n').filter(Boolean)
    return (
      <div className="space-y-1">
        <div className="text-[11px] text-muted-foreground/60">
          {files.length} 个文件
        </div>
        <div className="rounded-md bg-muted/20 p-2 space-y-0.5">
          {visibleFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[12px] font-mono text-foreground/70 py-0.5">
              <FileTypeIcon name={file.split('/').pop() || file} isDirectory={false} size={12} />
              <span className="truncate">{file}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }, [files.length])

  return (
    <CollapsibleResult
      content={result}
      previewLines={20}
      renderContent={renderList}
    />
  )
}
