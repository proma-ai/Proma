/**
 * 快捷键中央注册表
 *
 * 单一全局 keydown listener + Map 分发模式。
 * 所有快捷键监听集中在一处，避免多个 addEventListener 分散注册。
 */

import { DEFAULT_SHORTCUTS, SHORTCUT_MAP } from './shortcut-defaults'
import type { ShortcutOverrides } from './shortcut-defaults'

// ===== 平台检测 =====

const isMac =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

// ===== 注册表状态 =====

/** shortcutId → handler 集合 */
const handlers = new Map<string, Set<() => void>>()

/** 当前用户自定义配置 */
let currentOverrides: ShortcutOverrides = {}

/** 是否已初始化 */
let initialized = false

// ===== 快捷键匹配 =====

interface ParsedAccelerator {
  cmd: boolean
  shift: boolean
  alt: boolean
  key: string
}

/**
 * 解析快捷键字符串为结构化对象
 *
 * 支持格式：'Cmd+Shift+M'、'Ctrl+K'、'Cmd+,'
 */
function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = (parts[parts.length - 1] ?? '').toLowerCase()
  const modifiers = parts.slice(0, -1).map((m) => m.toLowerCase())

  return {
    cmd:
      modifiers.includes('cmd') ||
      modifiers.includes('ctrl') ||
      modifiers.includes('cmdorctrl'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt') || modifiers.includes('option'),
    key,
  }
}

/**
 * 检查键盘事件是否匹配解析后的快捷键
 *
 * 严格匹配：确保修饰键精确对应，防止 Cmd+K 被 Cmd+Shift+K 误触
 */
function matchesParsed(e: KeyboardEvent, parsed: ParsedAccelerator): boolean {
  // 修饰键匹配
  const cmdMatch = isMac ? e.metaKey : e.ctrlKey
  if (parsed.cmd !== cmdMatch) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false
  // macOS 上不应有 Ctrl 被意外按下（除非快捷键要求）
  if (isMac && !parsed.cmd && e.ctrlKey) return false

  // 按键匹配
  const eventKey = e.key.toLowerCase()
  return eventKey === parsed.key
}

// ===== 预计算加速器缓存 =====

/** 缓存：shortcutId → ParsedAccelerator */
let parsedCache = new Map<string, ParsedAccelerator>()

/** 重建缓存（配置变更时调用） */
function rebuildCache(): void {
  parsedCache = new Map()
  for (const def of DEFAULT_SHORTCUTS) {
    // 全局快捷键由主进程 globalShortcut 处理，不在渲染进程注册
    if (def.global) continue
    const accel = getActiveAccelerator(def.id)
    parsedCache.set(def.id, parseAccelerator(accel))
  }
}

// ===== 核心事件分发 =====

/**
 * 全局 keydown 事件处理器
 *
 * 遍历所有注册的快捷键，匹配后执行对应 handler
 */
function dispatchShortcut(e: KeyboardEvent): void {
  // 忽略输入法组合过程
  if (e.isComposing) return

  for (const [id, parsed] of parsedCache) {
    if (matchesParsed(e, parsed)) {
      const handlerSet = handlers.get(id)
      if (handlerSet && handlerSet.size > 0) {
        e.preventDefault()
        e.stopPropagation()
        // 执行所有注册的 handler
        for (const handler of handlerSet) {
          handler()
        }
      }
      return // 匹配一个即停止
    }
  }
}

// ===== 公开 API =====

/**
 * 初始化快捷键注册表
 *
 * 挂载全局 keydown listener，仅执行一次
 */
export function initShortcutRegistry(): void {
  if (initialized) return
  initialized = true
  rebuildCache()
  window.addEventListener('keydown', dispatchShortcut, true) // capture 阶段
}

/**
 * 注册快捷键 handler
 *
 * @returns 注销函数
 */
export function registerShortcut(
  id: string,
  callback: () => void,
): () => void {
  if (!handlers.has(id)) {
    handlers.set(id, new Set())
  }
  handlers.get(id)!.add(callback)

  return () => {
    const set = handlers.get(id)
    if (set) {
      set.delete(callback)
      if (set.size === 0) handlers.delete(id)
    }
  }
}

/**
 * 更新用户自定义快捷键配置
 *
 * 配置变更后自动重建匹配缓存
 */
export function updateShortcutOverrides(overrides: ShortcutOverrides): void {
  currentOverrides = overrides
  rebuildCache()
}

/**
 * 获取某快捷键当前生效的 accelerator 字符串
 *
 * 优先使用用户自定义，否则使用默认值
 */
export function getActiveAccelerator(id: string): string {
  const override = currentOverrides[id]
  if (override) {
    const customAccel = isMac ? override.mac : override.win
    if (customAccel) return customAccel
  }
  const def = SHORTCUT_MAP.get(id)
  if (!def) return ''
  return isMac ? def.defaultMac : def.defaultWin
}

/**
 * 获取快捷键的显示文本（用于 UI 展示）
 *
 * 将内部格式转换为用户友好的显示：Cmd → ⌘，Shift → ⇧ 等
 */
export function getAcceleratorDisplay(accelerator: string): string {
  if (!accelerator) return ''
  if (isMac) {
    return accelerator
      .replace(/Cmd\+/gi, '⌘')
      .replace(/Shift\+/gi, '⇧')
      .replace(/Alt\+/gi, '⌥')
      .replace(/Ctrl\+/gi, '⌃')
      .replace(/Backspace/gi, '⌫')
  }
  return accelerator
}

/**
 * 检查快捷键冲突
 *
 * @returns 冲突的快捷键 ID，无冲突返回 null
 */
export function checkConflict(
  accelerator: string,
  excludeId?: string,
): string | null {
  const parsed = parseAccelerator(accelerator)
  for (const def of DEFAULT_SHORTCUTS) {
    if (excludeId && def.id === excludeId) continue
    const existingAccel = getActiveAccelerator(def.id)
    const existingParsed = parseAccelerator(existingAccel)
    if (
      parsed.cmd === existingParsed.cmd &&
      parsed.shift === existingParsed.shift &&
      parsed.alt === existingParsed.alt &&
      parsed.key === existingParsed.key
    ) {
      return def.id
    }
  }
  return null
}

/** 导出平台信息供其他模块使用 */
export { isMac }
