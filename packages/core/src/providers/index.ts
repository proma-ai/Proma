/**
 * Provider 适配器注册表
 *
 * 集中管理所有已注册的供应商适配器，
 * 通过 ProviderType 查找对应的适配器实例。
 */

import type { ProviderType } from '@proma/shared'
import type { ProviderAdapter } from './types.ts'
import { AnthropicAdapter } from './anthropic-adapter.ts'
import { OpenAIAdapter } from './openai-adapter.ts'
import { GoogleAdapter } from './google-adapter.ts'
import { PromaAdapter } from './proma-adapter.ts'

// 导出所有类型和工具
export * from './types.ts'
export * from './sse-reader.ts'
export * from './url-utils.ts'

// 导出适配器类
export { AnthropicAdapter } from './anthropic-adapter.ts'
export { OpenAIAdapter } from './openai-adapter.ts'
export { GoogleAdapter } from './google-adapter.ts'
export { PromaAdapter } from './proma-adapter.ts'

/** 供应商适配器注册表 */
const adapterRegistry = new Map<ProviderType, ProviderAdapter>([
  ['proma', new PromaAdapter()],         // Proma 官方
  ['anthropic', new AnthropicAdapter()],
  ['openai', new OpenAIAdapter()],
  ['deepseek', new OpenAIAdapter()],      // DeepSeek 使用 OpenAI 兼容协议
  ['moonshot', new OpenAIAdapter()],      // Moonshot/Kimi 使用 OpenAI 兼容协议
  ['zhipu', new OpenAIAdapter()],         // 智谱 AI 使用 OpenAI 兼容协议
  ['minimax', new OpenAIAdapter()],       // MiniMax 使用 OpenAI 兼容协议
  ['doubao', new OpenAIAdapter()],        // 豆包使用 OpenAI 兼容协议
  ['qwen', new OpenAIAdapter()],          // 通义千问使用 OpenAI 兼容协议
  ['custom', new OpenAIAdapter()],        // 自定义也使用 OpenAI 兼容协议
  ['google', new GoogleAdapter()],
])

/**
 * 根据供应商类型获取适配器
 *
 * @param provider 供应商类型
 * @returns 对应的适配器实例
 * @throws Error 如果供应商类型不支持
 */
export function getAdapter(provider: ProviderType): ProviderAdapter {
  const adapter = adapterRegistry.get(provider)
  if (!adapter) {
    throw new Error(`不支持的供应商: ${provider}。你可能过去使用的是 Proma 商业版，请重新下载商业版覆盖安装，当前版本为开源版本。`)
  }
  return adapter
}
