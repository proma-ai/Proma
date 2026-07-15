/**
 * DefaultAppOpenButton — 用本机默认 App 打开预览文件
 *
 * 通过 useDefaultAppForFile 拿到本机为该文件类型注册的默认 App（含图标），
 * 渲染一个按钮；点击调用 systemOpenFile 让系统按默认 App 打开。
 * 右键弹出菜单：用默认 App 打开 / 在 Finder 中显示。
 * 探测失败或图标读取失败时不渲染。
 */

import * as React from 'react'
import type { FileAccessOptions } from '@proma/shared'
import { FolderOpen } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useDefaultAppForFile } from '@/hooks/useDefaultAppForFile'
import { cn } from '@/lib/utils'

interface DefaultAppOpenButtonProps {
  filePath: string
  /** 透传给 systemOpenFile 作为路径授权上下文 */
  access?: FileAccessOptions
  /** 紧凑模式（仅图标）/ 完整模式（图标 + App 名） */
  variant?: 'compact' | 'labeled'
  className?: string
}

export function DefaultAppOpenButton({
  filePath,
  access,
  variant = 'labeled',
  className,
}: DefaultAppOpenButtonProps): React.ReactElement | null {
  const info = useDefaultAppForFile(filePath, access)

  const handleClick = React.useCallback(() => {
    window.electronAPI.systemOpenFile(filePath, undefined, access).catch((err) => {
      console.error('[DefaultAppOpenButton] 打开文件失败:', err)
    })
  }, [filePath, access])

  const handleShowInFolder = React.useCallback(() => {
    window.electronAPI.showInFolder(filePath).catch((err) => {
      console.error('[DefaultAppOpenButton] 在文件夹中显示失败:', err)
    })
  }, [filePath])

  if (!info) return null

  const labeled = variant === 'labeled'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          title={`用 ${info.name} 打开编辑`}
          className={cn(
            'flex items-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors',
            labeled ? 'gap-1 h-6 px-1.5 max-w-[140px]' : 'justify-center size-6',
            className,
          )}
          aria-label={`用 ${info.name} 打开`}
        >
          <img
            src={info.iconDataUrl}
            alt=""
            className={cn('shrink-0', labeled ? 'size-4' : 'size-3.5')}
            draggable={false}
          />
          {labeled && (
            <span className="text-[11px] leading-none truncate">{info.name}</span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="z-[9999] min-w-0 p-0.5">
        <ContextMenuItem onSelect={handleClick}>
          <img src={info.iconDataUrl} alt="" className="size-4 shrink-0" draggable={false} />
          用 {info.name} 打开
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleShowInFolder}>
          <FolderOpen className="size-4 shrink-0" />
          在 Finder 中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
