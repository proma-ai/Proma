/**
 * 主题状态原子
 *
 * 管理应用主题模式（浅色/深色/跟随系统/特殊风格）和特殊风格。
 * - themeModeAtom: 用户选择的主题模式，持久化到 ~/.proma/settings.json
 * - themeStyleAtom: 特殊风格主题
 * - systemIsDarkAtom: 系统当前是否为深色模式
 * - resolvedThemeAtom: 派生的最终主题（light | dark）
 *
 * 使用 localStorage 作为缓存，避免页面加载时闪烁。
 */

import { atom } from 'jotai'
import { DEFAULT_INTERFACE_VARIANT, THEME_STYLES, type InterfaceVariant, type ThemeMode, type ThemeStyle } from '../../types'

/** localStorage 缓存键 */
const THEME_CACHE_KEY = 'proma-theme-mode'
const THEME_STYLE_CACHE_KEY = 'proma-theme-style'
const INTERFACE_VARIANT_CACHE_KEY = 'proma-interface-variant'

/**
 * 从 localStorage 读取缓存的主题模式
 */
function getCachedThemeMode(): ThemeMode {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY)
    if (cached === 'light' || cached === 'dark' || cached === 'system' || cached === 'special') {
      return cached
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return 'dark'
}

/**
 * 从 localStorage 读取缓存的特殊风格
 */
function getCachedThemeStyle(): ThemeStyle {
  try {
    const cached = localStorage.getItem(THEME_STYLE_CACHE_KEY)
    if ((THEME_STYLES as readonly string[]).includes(cached ?? '')) {
      return cached as ThemeStyle
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return 'default'
}

/**
 * 从 localStorage 读取缓存的界面风格
 */
function getCachedInterfaceVariant(): InterfaceVariant {
  try {
    const cached = localStorage.getItem(INTERFACE_VARIANT_CACHE_KEY)
    if (cached === 'classic' || cached === 'modern') {
      return cached
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return DEFAULT_INTERFACE_VARIANT
}

/**
 * 缓存主题模式到 localStorage
 */
function cacheThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, mode)
  } catch {
    // localStorage 不可用时忽略
  }
}

/**
 * 缓存特殊风格到 localStorage
 */
function cacheThemeStyle(style: ThemeStyle): void {
  try {
    localStorage.setItem(THEME_STYLE_CACHE_KEY, style)
  } catch {
    // localStorage 不可用时忽略
  }
}

/**
 * 缓存界面风格到 localStorage
 */
function cacheInterfaceVariant(variant: InterfaceVariant): void {
  try {
    localStorage.setItem(INTERFACE_VARIANT_CACHE_KEY, variant)
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 用户选择的主题模式 */
export const themeModeAtom = atom<ThemeMode>(getCachedThemeMode())

/** 用户选择的特殊风格 */
export const themeStyleAtom = atom<ThemeStyle>(getCachedThemeStyle())

/** 用户选择的界面风格 */
export const interfaceVariantAtom = atom<InterfaceVariant>(getCachedInterfaceVariant())

/** 系统当前是否为深色模式 */
export const systemIsDarkAtom = atom<boolean>(true)

/** 派生：最终解析的主题（light | dark） */
export const resolvedThemeAtom = atom<'light' | 'dark'>((get) => {
  const mode = get(themeModeAtom)
  if (mode === 'system') {
    return get(systemIsDarkAtom) ? 'dark' : 'light'
  }
  if (mode === 'special') {
    const style = get(themeStyleAtom)
    // 根据特殊风格决定是浅色还是深色基调
    return style.endsWith('-light') ? 'light' : 'dark'
  }
  return mode
})

/** 所有特殊风格 class（用于清理旧值）— 从 THEME_STYLES 单一源派生，排除 'default' */
const ALL_THEME_STYLE_CLASSES = THEME_STYLES
  .filter((style) => style !== 'default')
  .map((style) => `theme-${style}` as const)

/**
 * 应用主题到 DOM
 *
 * 在 <html> 元素上切换 dark 类名和特殊风格类名。
 *
 * 幂等实现：先计算目标 class 状态，与当前 DOM 对比，一致时直接 return，
 * 不触发任何 classList mutation。避免与 vibrancy 合成层叠加
 * 导致 Chromium 重建合成层造成的全屏闪烁。
 */
export function applyThemeToDOM(themeMode: ThemeMode, themeStyle: ThemeStyle = 'default', systemIsDark: boolean = true): void {
  const html = document.documentElement

  // 计算目标状态
  let targetStyleClass: string | null = null
  let targetIsDark: boolean

  if (themeMode === 'special' && themeStyle !== 'default') {
    targetStyleClass = `theme-${themeStyle}`
    targetIsDark = themeStyle.endsWith('-dark')
  } else if (themeMode === 'system') {
    targetIsDark = systemIsDark
  } else {
    targetIsDark = themeMode === 'dark'
  }

  // 读取当前状态
  const currentIsDark = html.classList.contains('dark')
  const currentStyleClass = ALL_THEME_STYLE_CLASSES.find((c) => html.classList.contains(c)) ?? null

  // 与目标一致 → 直接跳过，避免触发 CSS 重新级联
  if (currentIsDark === targetIsDark && currentStyleClass === targetStyleClass) {
    return
  }

  // [FLASH-DEBUG] 仅在真正发生 DOM 变更时打印
  console.log(
    `[FLASH-DEBUG] applyThemeToDOM apply: mode=${themeMode}, style=${themeStyle}, systemIsDark=${systemIsDark}, diff={dark: ${currentIsDark}→${targetIsDark}, style: ${currentStyleClass}→${targetStyleClass}}`
  )

  // 只修改确实需要变的 class
  if (currentStyleClass !== targetStyleClass) {
    if (currentStyleClass) {
      html.classList.remove(currentStyleClass)
    }
    if (targetStyleClass) {
      html.classList.add(targetStyleClass)
    }
  }
  if (currentIsDark !== targetIsDark) {
    html.classList.toggle('dark', targetIsDark)
  }
}

/**
 * 应用界面风格到 DOM
 */
export function applyInterfaceVariantToDOM(variant: InterfaceVariant = DEFAULT_INTERFACE_VARIANT): void {
  const html = document.documentElement
  const targetClass = variant === 'classic' ? 'ui-classic' : 'ui-modern'
  const currentClass = html.classList.contains('ui-classic')
    ? 'ui-classic'
    : html.classList.contains('ui-modern')
      ? 'ui-modern'
      : null

  if (currentClass === targetClass) {
    return
  }

  if (currentClass) {
    html.classList.remove(currentClass)
  }
  html.classList.add(targetClass)
}

/**
 * 初始化主题系统
 *
 * 从主进程加载设置，监听系统主题变化。
 * 返回清理函数。
 */
export async function initializeTheme(
  setThemeMode: (mode: ThemeMode) => void,
  setSystemIsDark: (isDark: boolean) => void,
  setThemeStyle?: (style: ThemeStyle) => void,
  setInterfaceVariant?: (variant: InterfaceVariant) => void,
): Promise<() => void> {
  // 从主进程加载持久化设置
  const settings = await window.electronAPI.getSettings()
  setThemeMode(settings.themeMode)
  cacheThemeMode(settings.themeMode)

  // 加载特殊风格
  if (setThemeStyle && settings.themeStyle) {
    setThemeStyle(settings.themeStyle)
    cacheThemeStyle(settings.themeStyle)
  }

  const interfaceVariant = settings.interfaceVariant || DEFAULT_INTERFACE_VARIANT
  if (setInterfaceVariant) {
    setInterfaceVariant(interfaceVariant)
  }
  cacheInterfaceVariant(interfaceVariant)

  // 获取系统主题
  const isDark = await window.electronAPI.getSystemTheme()
  setSystemIsDark(isDark)

  // 监听系统主题变化
  const cleanupSystem = window.electronAPI.onSystemThemeChanged((newIsDark) => {
    setSystemIsDark(newIsDark)
  })

  // 监听用户手动切换主题（跨窗口同步，如 Quick Task 面板）
  const cleanupThemeSettings = window.electronAPI.onThemeSettingsChanged((payload) => {
    const mode = payload.themeMode as ThemeMode
    const style = (payload.themeStyle || 'default') as ThemeStyle
    const variant = (payload.interfaceVariant || DEFAULT_INTERFACE_VARIANT) as InterfaceVariant
    setThemeMode(mode)
    cacheThemeMode(mode)
    if (setThemeStyle) {
      setThemeStyle(style)
      cacheThemeStyle(style)
    }
    if (setInterfaceVariant) {
      setInterfaceVariant(variant)
      cacheInterfaceVariant(variant)
    }
  })

  return () => {
    cleanupSystem()
    cleanupThemeSettings()
  }
}

/**
 * 更新主题模式并持久化
 *
 * 同时更新 localStorage 缓存和主进程配置文件。
 */
export async function updateThemeMode(mode: ThemeMode): Promise<void> {
  cacheThemeMode(mode)
  await window.electronAPI.updateSettings({ themeMode: mode })
}

/**
 * 更新特殊风格并持久化
 */
export async function updateThemeStyle(style: ThemeStyle): Promise<void> {
  cacheThemeStyle(style)
  await window.electronAPI.updateSettings({ themeStyle: style })
}

/**
 * 更新界面风格并持久化
 */
export async function updateInterfaceVariant(variant: InterfaceVariant): Promise<void> {
  cacheInterfaceVariant(variant)
  await window.electronAPI.updateSettings({ interfaceVariant: variant })
}
