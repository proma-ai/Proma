import { BrowserWindow, nativeTheme } from 'electron'
import type { ThemeMode, ThemeStyle } from '../../types'
import { getSettings } from './settings-service'

interface OverlayColors {
  color: string
  symbolColor: string
  height: number
}

const OVERLAY_HEIGHT = 40

// Colors are computed as: alpha-composite of hsl(--muted / 0.5) over hsl(--content-area),
// matching the actual rendered TabBar background color to eliminate the visual seam on Windows.
const THEME_COLORS: Record<string, { color: string; symbolColor: string }> = {
  'default-light': { color: '#fafafa', symbolColor: '#0a0a0a' },
  'default-dark': { color: '#1c1c1c', symbolColor: '#fafafa' },
  'ocean-light': { color: '#e6eef5', symbolColor: '#1b2632' },
  'ocean-dark': { color: '#131c26', symbolColor: '#e7ebef' },
  'forest-light': { color: '#ecf1ee', symbolColor: '#1d3026' },
  'forest-dark': { color: '#16201b', symbolColor: '#e3e8e5' },
  'slate-light': { color: '#e6e4df', symbolColor: '#312f2a' },
  'slate-dark': { color: '#1f1c21', symbolColor: '#e9e6e3' },
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
