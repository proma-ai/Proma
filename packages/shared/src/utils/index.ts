/**
 * Shared utility functions for proma
 */

// Placeholder - will be expanded as needed
export function noop(): void {
  // no-op
}

export { diffCapabilities } from './capabilities-diff'
export type { CapabilityChange } from './capabilities-diff'
export {
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
  CODEX_GPT_54_55_CONTEXT_WINDOW,
  CODEX_GPT_54_MINI_CONTEXT_WINDOW,
  CODEX_GPT_56_CONTEXT_WINDOW,
  inferCodexAlignedGPT5ContextWindow,
  supports1MContext,
  inferContextWindow,
  inferAgentSdkContextWindow,
  resolveAgentSdkModelId,
} from './context-window'
export { calculateContextUsageRatio } from './context-usage'
export {
  inferMcpTransportType,
  normalizeMcpTransportType,
} from './mcp-transport'
export {
  THINKING_SIGNATURE_ERROR_CODE,
  THINKING_SIGNATURE_ERROR_TITLE,
  THINKING_SIGNATURE_ERROR_MESSAGE,
  isThinkingSignatureError,
  formatThinkingSignatureError,
  normalizeThinkingSignatureError,
} from './thinking-signature-error'
export { normalizePathForCompare } from './normalize-path'
export {
  getSDKCompactStatus,
  isPersistableSDKSystemMessage,
  type SDKCompactStatus,
} from './agent-system-message'
