/**
 * DefaultAppOpenButton — 用本机默认 App 打开预览文件
 *
 * 通过 useDefaultAppForFile 拿到本机为该文件类型注册的默认 App（含图标），
 * 渲染一个按钮；点击调用 systemOpenFile 让系统按默认 App 打开。
 * 探测未完成或失败时，使用通用图标和文案保留打开入口。
 */

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import type { FileAccessOptions } from '@proma/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDefaultAppForFile } from '@/hooks/useDefaultAppForFile'
import { getDefaultAppOpenLabel } from '@/lib/default-app-open-label'
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

  const labeled = variant === 'labeled'
  const label = getDefaultAppOpenLabel(info)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'flex items-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors',
            labeled ? 'gap-1 h-6 px-1.5 max-w-[140px]' : 'justify-center size-6',
            className,
          )}
          aria-label={label}
        >
          {info ? (
            <img
              src={info.iconDataUrl}
              alt=""
              className={cn('shrink-0', labeled ? 'size-4' : 'size-3.5')}
              draggable={false}
            />
          ) : (
            <ExternalLink className={cn('shrink-0', labeled ? 'size-4' : 'size-3.5')} />
          )}
          {labeled && (
            <span className="text-[11px] leading-none truncate">{info?.name ?? '系统默认应用'}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{info ? `用 ${info.name} 打开编辑` : '用系统默认应用打开'}</p>
      </TooltipContent>
    </Tooltip>
  )
}
