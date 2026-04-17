/**
 * 全局快捷键服务（主进程）
 *
 * 使用 Electron globalShortcut API 注册系统级快捷键。
 * 全局快捷键在应用不在前台时也能触发。
 *
 * 与渲染进程的 shortcut-registry 完全独立：
 * - 渲染进程：keydown listener，仅应用内生效
 * - 主进程：globalShortcut.register，系统级生效
 */

import { app, globalShortcut } from 'electron'
import { getSettings } from './settings-service'

/** 全局快捷键 ID → 回调映射 */
const globalCallbacks = new Map<string, () => void>()

/** 当前注册的 accelerator → 快捷键 ID 映射（用于注销） */
const registeredAccelerators = new Map<string, string>()

/** 默认全局快捷键配置 */
const GLOBAL_SHORTCUT_DEFAULTS: Record<string, { mac: string; win: string }> = {
  'quick-task': { mac: 'Alt+Space', win: 'Alt+Space' },
  'show-main-window': { mac: 'CommandOrControl+Shift+P', win: 'CommandOrControl+Shift+P' },
}

const isMac = process.platform === 'darwin'

/**
 * 获取某全局快捷键当前生效的 Electron accelerator 字符串
 *
 * 优先使用用户自定义，否则使用默认值。
 * 将 Cmd/Ctrl 统一转为 Electron 的 CommandOrControl。
 */
function getGlobalAccelerator(id: string): string {
  const settings = getSettings()
  const override = settings.shortcutOverrides?.[id]

  let accelerator: string
  if (override) {
    const customAccel = isMac ? override.mac : override.win
    if (customAccel) {
      accelerator = customAccel
    } else {
      const def = GLOBAL_SHORTCUT_DEFAULTS[id]
      accelerator = def ? (isMac ? def.mac : def.win) : ''
    }
  } else {
    const def = GLOBAL_SHORTCUT_DEFAULTS[id]
    accelerator = def ? (isMac ? def.mac : def.win) : ''
  }

  // 转换为 Electron 标准格式
  return accelerator
    .replace(/Cmd\+/gi, 'CommandOrControl+')
    .replace(/Ctrl\+/gi, 'CommandOrControl+')
}

/**
 * 注册单个全局快捷键
 *
 * @returns 是否注册成功（可能被系统占用）
 */
function registerOne(id: string): boolean {
  const callback = globalCallbacks.get(id)
  if (!callback) return false

  const accelerator = getGlobalAccelerator(id)
  if (!accelerator) return false

  try {
    const success = globalShortcut.register(accelerator, callback)
    if (success) {
      registeredAccelerators.set(accelerator, id)
      console.log(`[全局快捷键] 注册成功: ${id} → ${accelerator}`)
    } else {
      console.warn(`[全局快捷键] 注册失败（可能被占用）: ${id} → ${accelerator}`)
    }
    return success
  } catch (err) {
    console.error(`[全局快捷键] 注册异常: ${id} → ${accelerator}`, err)
    return false
  }
}

/**
 * 注册全局快捷键回调
 *
 * 在 app.whenReady() 后调用。设置回调函数并尝试注册。
 */
export function registerGlobalShortcut(id: string, callback: () => void): boolean {
  globalCallbacks.set(id, callback)
  return registerOne(id)
}

/**
 * 重新注册所有全局快捷键
 *
 * 用户在设置中修改全局快捷键后调用。
 * 先注销所有已注册的，再重新注册。
 */
export function reregisterAllGlobalShortcuts(): Record<string, boolean> {
  // 注销所有已注册的
  for (const accelerator of registeredAccelerators.keys()) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      // 忽略注销错误
    }
  }
  registeredAccelerators.clear()

  // 重新注册所有有回调的快捷键
  const results: Record<string, boolean> = {}
  for (const id of globalCallbacks.keys()) {
    results[id] = registerOne(id)
  }
  return results
}

/**
 * 注销所有全局快捷键
 *
 * 在 app.will-quit / before-quit 时调用。
 */
export function unregisterAllGlobalShortcuts(): void {
  if (app.isReady()) {
    globalShortcut.unregisterAll()
  }
  registeredAccelerators.clear()
  globalCallbacks.clear()
  console.log('[全局快捷键] 已注销所有')
}
