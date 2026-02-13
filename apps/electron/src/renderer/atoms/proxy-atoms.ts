/**
 * 代理配置状态管理
 *
 * 使用 Jotai 管理全局代理配置，支持系统代理自动检测和手动配置。
 */

import { atom } from 'jotai'
import type { ProxyConfig } from '@proma/shared'

/**
 * 代理配置 Atom
 *
 * 从主进程获取，支持系统代理和手动配置两种模式。
 */
export const proxyConfigAtom = atom<ProxyConfig | null>(null)

/**
 * 加载代理配置
 */
export const loadProxyConfigAtom = atom(null, async (get, set) => {
  try {
    const config = await window.electronAPI.getProxySettings()
    set(proxyConfigAtom, config)
  } catch (error) {
    console.error('[代理配置] 加载失败:', error)
  }
})

/**
 * 更新代理配置
 */
export const updateProxyConfigAtom = atom(
  null,
  async (get, set, config: ProxyConfig) => {
    try {
      await window.electronAPI.updateProxySettings(config)
      set(proxyConfigAtom, config)
    } catch (error) {
      console.error('[代理配置] 更新失败:', error)
      throw error
    }
  }
)
