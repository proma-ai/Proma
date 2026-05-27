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

export interface ShortcutRegistrationOptions {
  /**
   * 独占模式。若同一快捷键的任一注册项设置了 exclusive=true，
   * 则仅执行**最后注册的** exclusive handler，其余 handler（无论是否 exclusive）均被跳过。
   * 用于在嵌套场景中让"最内层"组件捕获快捷键，避免触发外层全局逻辑。
   */
  exclusive?: boolean
}

interface ShortcutHandlerEntry {
  callback: () => void
  options: ShortcutRegistrationOptions
}

/** shortcutId → handler 集合 */
const handlers = new Map<string, Set<ShortcutHandlerEntry>>()

/** 当前用户自定义配置 */
let currentOverrides: ShortcutOverrides = {}

/** 是否已初始化 */
let initialized = false

// ===== 快捷键匹配 =====

interface ParsedAccelerator {
  cmd: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

function normalizeKeyName(key: string): string {
  if (key === ' ') return 'space'

  const keyMap: Record<string, string> = {
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    escape: 'esc',
    return: 'enter',
    '+': 'plus',
  }
  const mapped = keyMap[key.toLowerCase()]
  return (mapped ?? key).toLowerCase()
}

function isModifierName(part: string): boolean {
  const key = part.toLowerCase()
  return [
    'cmd',
    'command',
    'meta',
    'super',
    'ctrl',
    'control',
    'cmdorctrl',
    'commandorcontrol',
    'shift',
    'alt',
    'option',
  ].includes(key)
}

/**
 * 解析快捷键字符串为结构化对象
 *
 * 支持格式：'Cmd+Shift+M'、'Ctrl+K'、'CmdOrCtrl+,'
 */
function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+').map((p) => p.trim())
  const isModifierOnly = parts.length > 0 && parts.every(isModifierName)
  const key = isModifierOnly ? '' : normalizeKeyName(parts[parts.length - 1] ?? '')
  const modifiers = (isModifierOnly ? parts : parts.slice(0, -1)).map((m) => m.toLowerCase())
  const hasCmdOrCtrl =
    modifiers.includes('cmdorctrl') || modifiers.includes('commandorcontrol')

  return {
    cmd:
      modifiers.includes('cmd') ||
      modifiers.includes('command') ||
      modifiers.includes('meta') ||
      modifiers.includes('super') ||
      (isMac && hasCmdOrCtrl),
    ctrl:
      modifiers.includes('ctrl') ||
      modifiers.includes('control') ||
      (!isMac && hasCmdOrCtrl),
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
  if (parsed.cmd !== e.metaKey) return false
  if (parsed.ctrl !== e.ctrlKey) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false

  // 按键匹配
  if (!parsed.key) {
    return ['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)
  }

  const eventKey = normalizeKeyName(e.key)
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
    // 用户已禁用的快捷键不进入分发缓存
    if (accel === null) continue
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
        const handlerEntries = Array.from(handlerSet)
        let exclusiveEntry: ShortcutHandlerEntry | undefined
        for (let i = handlerEntries.length - 1; i >= 0; i--) {
          if (handlerEntries[i]!.options.exclusive) {
            exclusiveEntry = handlerEntries[i]
            break
          }
        }
        if (exclusiveEntry) {
          exclusiveEntry.callback()
        } else {
          // 执行所有注册的 handler
          for (const entry of handlerEntries) {
            entry.callback()
          }
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
  options: ShortcutRegistrationOptions = {},
): () => void {
  if (!handlers.has(id)) {
    handlers.set(id, new Set())
  }
  const entry: ShortcutHandlerEntry = { callback, options }
  handlers.get(id)!.add(entry)

  return () => {
    const set = handlers.get(id)
    if (set) {
      set.delete(entry)
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
 * 返回值含义：
 * - 非空字符串：当前生效的 accelerator（用户自定义或默认值）
 * - `null`：用户已禁用此快捷键，不应注册任何监听
 * - 空字符串：定义不存在或该平台无默认值
 */
export function getActiveAccelerator(id: string): string | null {
  const override = currentOverrides[id]
  if (override) {
    const customAccel = isMac ? override.mac : override.win
    if (customAccel === null) return null
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
export function getAcceleratorDisplay(accelerator: string | null): string {
  if (!accelerator) return ''
  if (isMac) {
    return accelerator
      .split('+')
      .map((part) => {
        const normalized = part.trim().toLowerCase()
        if (['cmd', 'command', 'meta', 'super'].includes(normalized)) return '⌘'
        if (['ctrl', 'control'].includes(normalized)) return '⌃'
        if (normalized === 'shift') return '⇧'
        if (['alt', 'option'].includes(normalized)) return '⌥'
        if (normalized === 'backspace') return '⌫'
        return part
      })
      .join('')
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
    // 已禁用的快捷键不占用任何按键组合，不参与冲突检测
    if (existingAccel === null || existingAccel === '') continue
    const existingParsed = parseAccelerator(existingAccel)
    if (
      parsed.cmd === existingParsed.cmd &&
      parsed.ctrl === existingParsed.ctrl &&
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
