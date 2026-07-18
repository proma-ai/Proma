import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isCodexFastModeSupportedModel } from '@proma/shared'

type ProviderPayload = Record<string, unknown>

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
  if (!isCodexFastModeSupportedModel(modelId) || 'service_tier' in payload) return payload

  return { ...payload, service_tier: 'priority' }
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
