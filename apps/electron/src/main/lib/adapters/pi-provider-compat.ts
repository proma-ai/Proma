import type { ProviderType } from '@proma/shared'

/**
 * 某些 OpenAI 兼容接口只接受 system、user、assistant 和 tool 角色。
 * Pi 默认会把系统提示词编码为 developer，因此必须显式请求降级为 system。
 *
 * custom 是任意 OpenAI 兼容端点的通用入口，保守地使用所有兼容服务都支持的
 * system 角色。原生 OpenAI 渠道仍可使用 developer。
 */
export function supportsPiDeveloperRole(provider: ProviderType): boolean {
  return provider !== 'doubao' && provider !== 'custom'
}
