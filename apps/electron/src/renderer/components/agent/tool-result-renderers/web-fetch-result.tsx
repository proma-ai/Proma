/**
 * WebFetch 工具结果渲染器 — Markdown 渲染
 *
 * 复用 MessageResponse 组件渲染抓取到的网页内容
 */

import * as React from 'react'
import { MessageResponse } from '@/components/ai-elements/message'
import { CollapsibleResult } from './collapsible-result'

interface WebFetchResultRendererProps {
  result: string
  isError: boolean
}

export function WebFetchResultRenderer({ result, isError }: WebFetchResultRendererProps): React.ReactElement {
  if (isError) {
    return (
      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  return (
    <CollapsibleResult
      content={result}
      threshold={5000}
      previewLines={30}
      renderContent={(text) => (
        <div className="rounded-md bg-muted/20 p-3 overflow-x-auto text-[13px]">
          <MessageResponse>{text}</MessageResponse>
        </div>
      )}
    />
  )
}
