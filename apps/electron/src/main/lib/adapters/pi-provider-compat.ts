import type { ProviderType } from '@proma/shared'

/**
 * 某些 OpenAI 兼容接口只接受 system、user、assistant 和 tool 角色。
 * Pi 默认会把系统提示词编码为 developer，因此必须显式请求降级为 system。
 *
 * custom 是任意 OpenAI 兼容端点的通用入口，保守地使用所有兼容服务都支持的
 * system 角色。原生 OpenAI 渠道仍可使用 developer。
 *
 * orcarouter 是模型路由网关，后端路由到多家供应商的模型，模型间角色支持
 * 不尽相同，保守地统一使用 system 角色。
 */
export function supportsPiDeveloperRole(provider: ProviderType): boolean {
  return provider !== 'doubao'
    && provider !== 'qwen'
    && provider !== 'custom'
    && provider !== 'orcarouter'
}
