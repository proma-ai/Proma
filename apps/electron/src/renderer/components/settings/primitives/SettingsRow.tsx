/**
 * SettingsRow - 设置行布局
 *
 * 左侧显示标签和描述，右侧显示操作控件。
 * 通常用于 SettingsCard 内部。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { LABEL_CLASS, DESCRIPTION_CLASS, ROW_CLASS } from './SettingsUIConstants'

interface SettingsRowProps {
  /** 行标签 */
  label: string
  /** 标签左侧图标（可选） */
  icon?: React.ReactNode
  /** 行描述（可选） */
  description?: React.ReactNode
  /** 右侧控件 */
  children?: React.ReactNode
  /** 额外 className */
  className?: string
}

export function SettingsRow({
  label,
  icon,
  description,
  children,
  className,
}: SettingsRowProps): React.ReactElement {
  return (
    <div className={cn(ROW_CLASS, className)}>
      {icon && <div className="flex-shrink-0 mr-3">{icon}</div>}
      <div className="flex-1 min-w-0 mr-4">
        <div className={LABEL_CLASS}>{label}</div>
        {description && (
          <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  )
}
