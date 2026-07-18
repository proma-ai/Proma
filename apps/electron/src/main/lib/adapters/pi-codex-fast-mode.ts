import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isCodexFastModeSupportedModel } from '@proma/shared'

type ProviderPayload = Record<string, unknown>

export const CODEX_FAST_MODE_SERVICE_TIER = 'priority'

function isProviderPayload(payload: unknown): payload is ProviderPayload {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}

/**
 * 为符合条件的 Codex Responses 请求附加 OpenAI priority service tier。
 *
 * Pi 的扩展钩子位于实际请求 payload 构建之后，因此能同时覆盖首轮、
 * tool continuation、队列续轮与恢复会话后的全部 provider request。
 */
export function injectCodexFastMode(payload: unknown): unknown {
  if (!isProviderPayload(payload)) return payload
  const modelId = typeof payload.model === 'string' ? payload.model : undefined
  if (!isCodexFastModeSupportedModel(modelId)) return payload

  // Fast Mode 是明确的用户选择，必须覆盖先加载的用户扩展写入的 tier，
  // 避免 UI 显示 Fast、实际请求却退化为 default/flex。
  return { ...payload, service_tier: CODEX_FAST_MODE_SERVICE_TIER }
}

/**
 * Pi Agent 的公开 streamFn 类型只暴露通用 SimpleStreamOptions，未包含 provider
 * 专属 serviceTier。运行时仍会把此字段完整传给 Codex Responses provider；保留它可
 * 让 Pi 按 priority tier 正确计算 usage.cost 与 Proma 预算守卫。
 */
export function withCodexFastModeServiceTier<T extends object | undefined>(options: T): T & { serviceTier: typeof CODEX_FAST_MODE_SERVICE_TIER } {
  return { ...options, serviceTier: CODEX_FAST_MODE_SERVICE_TIER } as T & { serviceTier: typeof CODEX_FAST_MODE_SERVICE_TIER }
}

/** Pi 内联扩展：Proma 不依赖用户安装第三方 Pi extension。 */
export function createCodexFastModeExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_provider_request', (event) => {
      const updatedPayload = injectCodexFastMode(event.payload)
      return updatedPayload === event.payload ? undefined : updatedPayload
    })
  }
}
