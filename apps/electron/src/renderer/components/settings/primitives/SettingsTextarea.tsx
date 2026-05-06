/**
 * SettingsTextarea - 设置多行文本输入控件
 */

import * as React from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './SettingsUIConstants'

interface SettingsTextareaProps {
  /** 标签文本 */
  label: string
  /** 描述文本（可选） */
  description?: string
  /** 输入值 */
  value: string
  /** 变更回调 */
  onChange: (value: string) => void
  /** 占位符 */
  placeholder?: string
  /** 最小高度 */
  minHeight?: number
  /** 是否禁用 */
  disabled?: boolean
  /** 错误信息（可选） */
  error?: string
}

export function SettingsTextarea({
  label,
  description,
  value,
  onChange,
  placeholder,
  minHeight = 96,
  disabled,
  error,
}: SettingsTextareaProps): React.ReactElement {
  return (
    <div className="px-4 py-3 space-y-2">
      <div>
        <div className={LABEL_CLASS}>{label}</div>
        {description && (
          <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'resize-y',
          error && 'border-destructive focus-visible:ring-destructive',
        )}
        style={{ minHeight }}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
