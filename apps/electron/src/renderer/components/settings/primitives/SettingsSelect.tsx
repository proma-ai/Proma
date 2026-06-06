/**
 * SettingsSelect - 设置下拉选择控件
 *
 * 封装 ShadcnUI Select，集成标签和描述。
 * 用于有限选项的设置项。
 */

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './SettingsUIConstants'
import { cn } from '@/lib/utils'

/** 选项定义 */
export interface SelectOption {
  value: string
  label: string
  /** 选项图标 URL（可选） */
  icon?: string
}

interface SettingsSelectProps {
  /** 标签文本 */
  label: string
  /** 描述文本（可选） */
  description?: string
  /** 当前值 */
  value: string
  /** 变更回调 */
  onValueChange: (value: string) => void
  /** 选项列表 */
  options: SelectOption[]
  /** 占位符 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
}

export function SettingsSelect({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
}: SettingsSelectProps): React.ReactElement {
  const selected = React.useMemo(() => options.find((o) => o.value === value), [options, value])

  return (
    <div className="px-4 py-3 space-y-2">
      <div>
        <div className={LABEL_CLASS}>{label}</div>
        {description && (
          <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder}>
            {selected ? (
              <span className="flex items-center gap-2">
                {selected.icon && <img src={selected.icon} alt="" className="w-4 h-4 rounded-sm object-contain" />}
                <span>{selected.label}</span>
              </span>
            ) : placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                {option.icon && <img src={option.icon} alt="" className="w-4 h-4 rounded-sm object-contain" />}
                <span>{option.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
