/**
 * AppearanceSettings - 外观设置页
 *
 * 特殊风格选择 + 主题模式切换（浅色/深色/跟随系统/特殊风格）。
 * 通过 Jotai atom 管理状态，持久化到 ~/.proma/settings.json。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
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

// ===== Logo 资源导入（用于图标选择器） =====
import promaBlackLogo from '@/assets/bots/proma-logos/proma-black.png'
import promaWhiteLogo from '@/assets/bots/proma-logos/proma-white.png'
import promaBlueLogo from '@/assets/bots/proma-logos/proma-blue.png'
import promaPurpleLogo from '@/assets/bots/proma-logos/proma-purple.png'
import promaGradientLogo from '@/assets/bots/proma-logos/proma-gradient.png'
import promaCoralLogo from '@/assets/bots/proma-logos/proma-coral.png'
import promaVeriPeriLogo from '@/assets/bots/proma-logos/proma-veri-peri.png'
import promaVivaMagentaLogo from '@/assets/bots/proma-logos/proma-viva-magenta.png'
import promaMochaMousseLogo from '@/assets/bots/proma-logos/proma-mocha-mousse.png'
import promaEmeraldLogo from '@/assets/bots/proma-logos/proma-emerald.png'
import proma8bitLogo from '@/assets/bots/proma-logos/proma-8bit.png'
import promaCyberpunkLogo from '@/assets/bots/proma-logos/proma-cyberpunk.png'
import promaFuturisticLogo from '@/assets/bots/proma-logos/proma-futuristic.png'

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
    preview: { left: '#c9dded', right: '#e2edf5' },
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

/** 图标变体定义 */
interface IconVariant {
  id: string
  name: string
  src: string
  previewBg: string
}

const ICON_VARIANTS: readonly IconVariant[] = [
  { id: 'default', name: '默认', src: '', previewBg: 'bg-neutral-900' },
  { id: 'black', name: '经典黑', src: promaBlackLogo, previewBg: 'bg-neutral-900' },
  { id: 'white', name: '纯白版', src: promaWhiteLogo, previewBg: 'bg-white' },
  { id: 'blue', name: '品牌蓝', src: promaBlueLogo, previewBg: 'bg-blue-900' },
  { id: 'purple', name: '紫色版', src: promaPurpleLogo, previewBg: 'bg-purple-900' },
  { id: 'gradient', name: '渐变版', src: promaGradientLogo, previewBg: 'bg-gradient-to-br from-blue-600 to-purple-600' },
  { id: 'coral', name: '珊瑚橘', src: promaCoralLogo, previewBg: 'bg-[#FF6F61]' },
  { id: 'veri-peri', name: '长春花蓝', src: promaVeriPeriLogo, previewBg: 'bg-[#6667AB]' },
  { id: 'viva-magenta', name: '非凡洋红', src: promaVivaMagentaLogo, previewBg: 'bg-[#BB2649]' },
  { id: 'mocha-mousse', name: '摩卡慕斯', src: promaMochaMousseLogo, previewBg: 'bg-[#A47764]' },
  { id: 'emerald', name: '翡翠绿', src: promaEmeraldLogo, previewBg: 'bg-[#009473]' },
  { id: '8bit', name: '8bit 像素', src: proma8bitLogo, previewBg: 'bg-[#1a1a2e]' },
  { id: 'cyberpunk', name: '赛博朋克', src: promaCyberpunkLogo, previewBg: 'bg-[#0d0221]' },
  { id: 'futuristic', name: '未来质感', src: promaFuturisticLogo, previewBg: 'bg-[#4a4a4a]' },
] as const

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
    <div className="space-y-6">
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

      <AppIconPicker />
    </div>
  )
}

/** 应用图标选择器 */
function AppIconPicker(): React.ReactElement {
  const [activeIcon, setActiveIcon] = React.useState<string>('default')
  const [isLoading, setIsLoading] = React.useState(false)

  // 初始化时读取当前设置
  React.useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      setActiveIcon(settings.appIconVariant ?? 'default')
    })
  }, [])

  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')

  const handleIconSelect = React.useCallback(async (variantId: string) => {
    if (isWindows) {
      toast.error('Windows 系统暂不支持更换应用图标')
      return
    }
    if (variantId === activeIcon || isLoading) return
    setIsLoading(true)
    try {
      const success = await window.electronAPI.setAppIcon(variantId)
      if (success) {
        setActiveIcon(variantId)
        toast.success('应用图标已更换')
      } else {
        toast.error('图标切换失败')
      }
    } catch {
      toast.error('图标切换失败')
    } finally {
      setIsLoading(false)
    }
  }, [activeIcon, isLoading, isWindows])

  return (
    <SettingsSection
      title="应用图标"
      description="自定义 Dock 栏中的应用图标样式"
    >
      <SettingsCard divided={false}>
        <div className="px-4 py-3">
          <div className="grid grid-cols-7 gap-3">
            {ICON_VARIANTS.map((variant) => (
              <IconCard
                key={variant.id}
                variant={variant}
                isSelected={activeIcon === variant.id}
                onSelect={() => handleIconSelect(variant.id)}
              />
            ))}
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** 图标选项卡片 */
function IconCard({
  variant,
  isSelected,
  onSelect,
}: {
  variant: IconVariant
  isSelected: boolean
  onSelect: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all',
        isSelected
          ? 'ring-2 ring-primary bg-primary/5'
          : 'hover:bg-muted/50'
      )}
    >
      <div
        className={cn(
          'w-12 h-12 rounded-xl overflow-hidden border border-border/50 flex items-center justify-center',
          variant.previewBg,
        )}
      >
        {variant.id === 'default' ? (
          // 默认图标用 CSS 模拟 Proma logo 形状
          <div className="flex items-end gap-[2px] -rotate-12">
            {[1, 0.85, 0.7, 0.55, 0.4, 0.25].map((opacity, i) => (
              <div
                key={i}
                className="rounded-[1px]"
                style={{
                  width: i === 0 ? 4 : 3,
                  height: i === 0 ? 14 : 14 - i * 1.5,
                  backgroundColor: `rgba(255,255,255,${opacity})`,
                }}
              />
            ))}
          </div>
        ) : (
          <img
            src={variant.src}
            alt={variant.name}
            className="w-full h-full object-contain"
            draggable={false}
          />
        )}
      </div>
      <span className="text-[10px] font-medium text-muted-foreground leading-tight text-center">
        {variant.name}
      </span>
      {isSelected && (
        <div className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-primary flex items-center justify-center">
          <Check className="size-2.5 text-primary-foreground" />
        </div>
      )}
    </button>
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
