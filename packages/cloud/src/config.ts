/**
 * Cloud API 配置
 */

/** API 配置选项 */
export interface CloudApiConfig {
  /** 后端 API 基础地址 */
  baseUrl: string
  /** 请求超时时间（毫秒） */
  timeout: number
}

/** 默认 API 配置 */
const DEFAULT_CONFIG: CloudApiConfig = {
  baseUrl: 'https://api.proma.cool/api/v1',
  timeout: 30_000,
}

/**
 * 获取 Cloud API 配置
 * 优先读取环境变量，否则使用默认值
 */
export function getCloudApiConfig(): CloudApiConfig {
  return {
    baseUrl: process.env.PROMA_API_URL || DEFAULT_CONFIG.baseUrl,
    timeout: DEFAULT_CONFIG.timeout,
  }
}
