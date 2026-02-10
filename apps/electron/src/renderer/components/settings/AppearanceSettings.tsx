/**
 * AppearanceSettings - 外观设置页
 *
 * 主题切换（浅色/深色/跟随系统），使用 SettingsSegmentedControl。
 * 通过 Jotai atom 管理状态，持久化到 ~/.proma/settings.json。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
} from './primitives'
import { themeModeAtom, updateThemeMode } from '@/atoms/theme'
import type { ThemeMode } from '../../../types'

/** 主题选项 */
const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

/** 根据平台返回缩放快捷键提示 */
const isMac = navigator.userAgent.includes('Mac')
const ZOOM_HINT = isMac
  ? '使用 ⌘+ 放大、⌘- 缩小、⌘0 恢复默认大小'
  : '使用 Ctrl++ 放大、Ctrl+- 缩小、Ctrl+0 恢复默认大小'

export function AppearanceSettings(): React.ReactElement {
  const [themeMode, setThemeMode] = useAtom(themeModeAtom)

  /** 切换主题模式 */
  const handleThemeChange = React.useCallback((value: string) => {
    const mode = value as ThemeMode
    setThemeMode(mode)
    updateThemeMode(mode)
  }, [setThemeMode])

  return (
    <SettingsSection
      title="外观设置"
      description="自定义应用的视觉风格"
    >
      <SettingsCard>
        <SettingsSegmentedControl
          label="主题模式"
          description="选择应用的配色方案"
          value={themeMode}
          onValueChange={handleThemeChange}
          options={THEME_OPTIONS}
        />
        <SettingsRow
          label="界面缩放"
          description={ZOOM_HINT}
        />
      </SettingsCard>
    </SettingsSection>
  )
}
