import * as React from 'react'
import { FileWarning } from 'lucide-react'
import type { FileAccessOptions, FilePreviewMetadata } from '@proma/shared'
import { DefaultAppOpenButton } from './DefaultAppOpenButton'

interface UnsupportedFilePreviewProps {
  filePath: string
  access?: FileAccessOptions
  reason: string
  metadata?: FilePreviewMetadata
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let index = -1
  do {
    value /= 1024
    index += 1
  } while (value >= 1024 && index < units.length - 1)
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function formatModifiedAt(modifiedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(modifiedAt)
}

/**
 * 二进制、超限或编码异常文件的安全降级卡片。
 *
 * 只展示来自主进程 stat 的基础元数据，绝不尝试读取或解码原始内容。
 */
export function UnsupportedFilePreview({
  filePath,
  access,
  reason,
  metadata,
}: UnsupportedFilePreviewProps): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10 text-center">
      <div className="w-full max-w-sm rounded-xl bg-muted/35 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.05)]">
        <FileWarning className="mx-auto size-7 text-muted-foreground/80" aria-hidden="true" />
        <h2 className="mt-3 text-sm font-medium text-foreground text-balance">无法安全内联预览</h2>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground text-pretty">{reason}</p>

        {metadata && (
          <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-background/70 px-3 py-2.5 text-left text-xs">
            <dt className="text-muted-foreground">文件</dt>
            <dd className="truncate text-foreground" title={metadata.name}>{metadata.name}</dd>
            <dt className="text-muted-foreground">类型</dt>
            <dd className="text-foreground">{metadata.extension || '无扩展名'}</dd>
            <dt className="text-muted-foreground">大小</dt>
            <dd className="tabular-nums text-foreground">{formatFileSize(metadata.size)}</dd>
            <dt className="text-muted-foreground">修改时间</dt>
            <dd className="tabular-nums text-foreground">{formatModifiedAt(metadata.modifiedAt)}</dd>
          </dl>
        )}

        <DefaultAppOpenButton
          filePath={filePath}
          access={access}
          variant="labeled"
          className="mx-auto mt-4 h-9 max-w-[220px] border border-border/60 bg-background px-3 shadow-sm"
        />
      </div>
    </div>
  )
}
