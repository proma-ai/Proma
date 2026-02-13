/**
 * 全局代理配置相关类型定义
 *
 * 代理配置存储在 ~/.proma/proxy-settings.json 中，支持系统代理自动检测和手动配置。
 */

/**
 * 代理模式
 */
export type ProxyMode = 'system' | 'manual'

/**
 * 全局代理配置
 */
export interface ProxyConfig {
  /** 是否启用代理 */
  enabled: boolean
  /** 代理模式：系统代理或手动配置 */
  mode: ProxyMode
  /** 手动配置的代理地址（如 http://127.0.0.1:7890），仅在 mode='manual' 时使用 */
  manualUrl: string
}

/**
 * 系统代理检测结果
 */
export interface SystemProxyDetectResult {
  /** 是否检测成功 */
  success: boolean
  /** 检测到的代理地址（如果有） */
  proxyUrl?: string
  /** 结果消息 */
  message: string
}

/**
 * 代理配置相关 IPC 通道常量
 */
export const PROXY_IPC_CHANNELS = {
  /** 获取代理配置 */
  GET_SETTINGS: 'proxy:get-settings',
  /** 更新代理配置 */
  UPDATE_SETTINGS: 'proxy:update-settings',
  /** 检测系统代理 */
  DETECT_SYSTEM: 'proxy:detect-system',
} as const
