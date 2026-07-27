import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isCodexFastModeSupportedModel } from '@proma/shared'

type ProviderPayload = Record<string, unknown>

export const CODEX_FAST_MODE_SERVICE_TIER = 'priority'

export interface CodexFastModeSettings {
  fastMode?: boolean
}

function isProviderPayload(payload: unknown): payload is ProviderPayload {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}

/** 为符合条件的 Codex Responses 请求附加 OpenAI priority service tier。 */
export function injectCodexFastMode(payload: unknown): unknown {
  if (!isProviderPayload(payload)) return payload
  const modelId = typeof payload.model === 'string' ? payload.model : undefined
  if (!isCodexFastModeSupportedModel(modelId)) return payload
  return { ...payload, service_tier: CODEX_FAST_MODE_SERVICE_TIER }
}

/** Pi Agent 内部 stream function 使用的 provider 专属 service tier。 */
export function withCodexFastModeServiceTier<T extends object | undefined>(options: T): T & { serviceTier: typeof CODEX_FAST_MODE_SERVICE_TIER } {
  return { ...options, serviceTier: CODEX_FAST_MODE_SERVICE_TIER } as T & { serviceTier: typeof CODEX_FAST_MODE_SERVICE_TIER }
}

/** Pi inline extension for Codex priority service tier. */
export function createCodexFastModeExtension(settings: CodexFastModeSettings): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_provider_request', (event) => {
      if (!settings.fastMode) return undefined
      const updatedPayload = injectCodexFastMode(event.payload)
      return updatedPayload === event.payload ? undefined : updatedPayload
    })
  }
}
