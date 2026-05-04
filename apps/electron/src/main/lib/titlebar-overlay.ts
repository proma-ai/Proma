import { BrowserWindow, nativeTheme } from 'electron'
import type { ThemeMode, ThemeStyle } from '../../types'
import { getSettings } from './settings-service'

interface OverlayColors {
  color: string
  symbolColor: string
  height: number
}

const OVERLAY_HEIGHT = 40

const THEME_COLORS: Record<string, { color: string; symbolColor: string }> = {
  'default-light': { color: '#ffffff', symbolColor: '#0a0a0a' },
  'default-dark': { color: '#121212', symbolColor: '#fafafa' },
  'ocean-light': { color: '#ecf2f7', symbolColor: '#1b2632' },
  'ocean-dark': { color: '#182434', symbolColor: '#e7ebef' },
  'forest-light': { color: '#eff5f1', symbolColor: '#1d3026' },
  'forest-dark': { color: '#212c26', symbolColor: '#e3e8e5' },
  'slate-light': { color: '#e3e1dc', symbolColor: '#312f2a' },
  'slate-dark': { color: '#1d1b20', symbolColor: '#e9e6e3' },
}

export function resolveOverlayColors(
  themeMode: ThemeMode,
  themeStyle: ThemeStyle | undefined,
  systemIsDark: boolean
): OverlayColors {
  let key: string

  if (themeMode === 'special' && themeStyle && themeStyle !== 'default') {
    key = themeStyle
  } else if (themeMode === 'system') {
    key = systemIsDark ? 'default-dark' : 'default-light'
  } else if (themeMode === 'dark') {
    key = 'default-dark'
  } else {
    key = 'default-light'
  }

  const colors = THEME_COLORS[key] ?? THEME_COLORS['default-dark']!
  return { color: colors.color, symbolColor: colors.symbolColor, height: OVERLAY_HEIGHT }
}

export function updateWindowTitleBarOverlay(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  if (win.isDestroyed()) return

  try {
    const settings = getSettings()
    const { color, symbolColor, height } = resolveOverlayColors(
      settings.themeMode,
      settings.themeStyle,
      nativeTheme.shouldUseDarkColors
    )
    win.setTitleBarOverlay({ color, symbolColor, height })
  } catch {
    // frameless 窗口（如 quick-task）不支持 setTitleBarOverlay，静默忽略
  }
}
