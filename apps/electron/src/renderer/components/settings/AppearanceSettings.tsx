/**
 * AppearanceSettings - 外观设置页
 *
 * 特殊风格选择 + 主题模式切换（浅色/深色/跟随系统/特殊风格）。
 * 通过 Jotai atom 管理状态，持久化到 ~/.proma/settings.json。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Check } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
} from './primitives'
import {
  themeModeAtom,
  themeStyleAtom,
  systemIsDarkAtom,
  updateThemeMode,
  updateThemeStyle,
  applyThemeToDOM,
} from '@/atoms/theme'
import { cn } from '@/lib/utils'
import type { ThemeMode, ThemeStyle } from '../../../types'

/** 主题选项 */
const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
  { value: 'special', label: '特殊风格' },
]

/** 特殊风格定义 */
interface SpecialStyle {
  id: ThemeStyle
  name: string
  variant: 'light' | 'dark'
  /** 预览色 */
  preview: {
    left: string   // 左侧色块（侧边栏）
    right: string  // 右侧色块（主背景）
  }
}

const SPECIAL_STYLES: SpecialStyle[] = [
  {
    id: 'slate-light',
    name: '云朵舞者',
    variant: 'light',
    preview: { left: '#e8e6e2', right: '#f0efec' },
  },
  {
    id: 'ocean-light',
    name: '晴空碧海',
    variant: 'light',
    preview: { left: '#b8d4e5', right: '#d4e5f0' },
  },
  {
    id: 'forest-light',
    name: '森息晨光',
    variant: 'light',
    preview: { left: '#e2e9e4', right: '#3f8361' },
  },
  {
    id: 'ocean-dark',
    name: '苍穹暮色',
    variant: 'dark',
    preview: { left: '#1a2535', right: '#3a6a9b' },
  },
  {
    id: 'forest-dark',
    name: '森息夜语',
    variant: 'dark',
    preview: { left: '#1b2721', right: '#185337' },
  },
  {
    id: 'slate-dark',
    name: '莫兰迪夜',
    variant: 'dark',
    preview: { left: '#272429', right: '#c9a89e' },
  },
]

/** 根据平台返回缩放快捷键提示 */
const isMac = navigator.userAgent.includes('Mac')
const ZOOM_HINT = isMac
  ? '使用 ⌘+ 放大、⌘- 缩小、⌘0 恢复默认大小'
  : '使用 Ctrl++ 放大、Ctrl+- 缩小、Ctrl+0 恢复默认大小'

export function AppearanceSettings(): React.ReactElement {
  const [themeMode, setThemeMode] = useAtom(themeModeAtom)
  const [themeStyle, setThemeStyle] = useAtom(themeStyleAtom)
  const systemIsDark = useAtomValue(systemIsDarkAtom)

  /** 切换主题模式 */
  const handleThemeChange = React.useCallback((value: string) => {
    const mode = value as ThemeMode
    setThemeMode(mode)
    updateThemeMode(mode)
    // 切换回普通模式时，重置特殊风格
    if (mode !== 'special') {
      setThemeStyle('default')
      updateThemeStyle('default')
      applyThemeToDOM(mode, 'default', systemIsDark)
    }
  }, [setThemeMode, setThemeStyle, systemIsDark])

  /** 选择特殊风格 */
  const handleStyleSelect = React.useCallback((style: ThemeStyle) => {
    // 同时切换到特殊风格模式
    setThemeMode('special')
    setThemeStyle(style)
    updateThemeMode('special')
    updateThemeStyle(style)
    applyThemeToDOM('special', style, systemIsDark)
  }, [setThemeMode, setThemeStyle, systemIsDark])

  return (
    <SettingsSection
      title="外观设置"
      description="自定义应用的视觉风格"
    >
      <SettingsCard>
        {/* 主题模式 - 最上面 */}
        <SettingsSegmentedControl
          label="主题模式"
          description="选择应用的配色方案"
          value={themeMode}
          onValueChange={handleThemeChange}
          options={THEME_OPTIONS}
        />

        {/* 特殊风格 - 标签在上，卡片在下 */}
        <div className="px-4 py-3 space-y-2">
          <div className="text-sm font-medium text-foreground">特殊风格</div>
          <div className="flex justify-between">
            {SPECIAL_STYLES.map((style) => (
              <StyleCard
                key={style.id}
                style={style}
                isSelected={themeMode === 'special' && themeStyle === style.id}
                onSelect={() => handleStyleSelect(style.id)}
              />
            ))}
          </div>
        </div>

        <SettingsRow
          label="界面缩放"
          description={ZOOM_HINT}
        />
      </SettingsCard>
    </SettingsSection>
  )
}

/** 特殊风格卡片 - 交叠圆圈预览 */
function StyleCard({
  style,
  isSelected,
  onSelect,
}: {
  style: SpecialStyle
  isSelected: boolean
  onSelect: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-lg p-3 transition-all',
        isSelected && 'shadow-lg shadow-primary/20 bg-card'
      )}
    >
      {/* 交叠圆圈预览 */}
      <div className="relative w-14 h-10">
        {/* 左圆 */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 size-10 rounded-full"
          style={{ backgroundColor: style.preview.left }}
        />
        {/* 右圆（叠在上面） */}
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 size-10 rounded-full"
          style={{ backgroundColor: style.preview.right }}
        />
      </div>
      {/* 名称 */}
      <span className="text-xs font-medium">{style.name}</span>
      {/* 选中标记 */}
      {isSelected && (
        <div className="absolute top-1 right-1 size-4 rounded-full bg-primary flex items-center justify-center">
          <Check className="size-2.5 text-primary-foreground" />
        </div>
      )}
    </button>
  )
}
