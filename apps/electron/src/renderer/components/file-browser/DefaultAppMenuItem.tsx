/**
 * DefaultAppMenuItem — DropdownMenuItem 形式的"用默认 App 打开"。
 *
 * 探测本机为该文件类型注册的默认 App，成功时显示「用 XX 打开」并带 App Logo。
 * 探测尚未完成或失败时，仍保留系统默认应用打开入口。
 */

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import type { FileAccessOptions } from '@proma/shared'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useDefaultAppForFile } from '@/hooks/useDefaultAppForFile'
import { getDefaultAppOpenLabel } from '@/lib/default-app-open-label'

interface DefaultAppMenuItemProps {
  filePath: string
  access?: FileAccessOptions
  className?: string
}

export function DefaultAppMenuItem({
  filePath,
  access,
  className,
}: DefaultAppMenuItemProps): React.ReactElement {
  const info = useDefaultAppForFile(filePath, access)

  return (
    <DropdownMenuItem
      className={className}
      onSelect={() => {
        window.electronAPI.systemOpenFile(filePath, undefined, access).catch((err) => {
          console.error('[DefaultAppMenuItem] 打开文件失败:', err)
        })
      }}
    >
      {info ? (
        <img
          src={info.iconDataUrl}
          alt=""
          className="size-3.5 shrink-0"
          draggable={false}
        />
      ) : (
        <ExternalLink />
      )}
      <span className="truncate">{getDefaultAppOpenLabel(info)}</span>
    </DropdownMenuItem>
  )
}
