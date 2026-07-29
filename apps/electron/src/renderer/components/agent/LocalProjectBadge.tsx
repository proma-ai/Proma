import type * as React from 'react'
import type { LocalProjectRootStatus } from '@proma/shared'
import { cn } from '@/lib/utils'

interface LocalProjectBadgeProps {
  projectRootPath?: string | null
  projectRootStatus?: LocalProjectRootStatus
  className?: string
}

const UNAVAILABLE_STATUS_LABELS: Record<Exclude<LocalProjectRootStatus, 'available'>, string> = {
  missing: '本地项目根目录已被删除',
  not_directory: '本地项目根路径不再是文件夹',
  unavailable: '本地项目根目录无法访问',
}

export function LocalProjectBadge({
  projectRootPath,
  projectRootStatus,
  className,
}: LocalProjectBadgeProps): React.ReactElement | null {
  if (!projectRootPath) return null

  const isUnavailable = projectRootStatus !== undefined && projectRootStatus !== 'available'
  const label = isUnavailable ? '根目录不可用' : '本地项目'

  return (
    <span
      title={isUnavailable ? UNAVAILABLE_STATUS_LABELS[projectRootStatus] : projectRootPath}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-1.5 py-0 text-[10px] font-medium leading-4',
        isUnavailable ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-muted-foreground',
        className,
      )}
    >
      {label}
    </span>
  )
}
