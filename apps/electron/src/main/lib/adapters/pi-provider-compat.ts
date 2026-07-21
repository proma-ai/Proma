import type { ProviderType } from '@proma/shared'

/**
 * 豆包 OpenAI 兼容接口只接受 system、user、assistant 和 tool 角色。
 * Pi 默认会把系统提示词编码为 developer，因此必须显式请求降级为 system。
 */
export function supportsPiDeveloperRole(provider: ProviderType): boolean {
  return provider !== 'doubao'
}
