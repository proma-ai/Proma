/**
 * Shared utility functions for proma
 */

// Placeholder - will be expanded as needed
export function noop(): void {
  // no-op
}

export {
  createAgentRuntimeRequest,
  createAgentRuntimeResponse,
  isAgentRuntimeEnvelope,
  isAgentRuntimeError,
  serializeAgentRuntimeError,
} from './agent-runtime'

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
} from './context-window'
export { calculateContextUsageRatio } from './context-usage'
export {
  PI_AUTO_COMPACTION_THRESHOLD_RATIO,
  calculatePiAutoCompactionReserveTokens,
  calculatePiAutoCompactionThresholdTokens,
} from './pi-compaction'
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
  MAX_NORMALIZED_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_QUERY_SOURCE_LENGTH,
  findBestSearchMatch,
  findBestSearchMatchInNormalized,
  normalizeSearchText,
  createSearchSnippet,
  insertTopSearchResult,
  type SearchMatch,
  type SearchMatchKind,
  type NormalizedSearchText,
  type SearchResultRank,
  type SearchSnippet,
} from './search-matching'
export {
  AUTOMATION_OCCURRENCE_SAMPLES_PER_DAY,
  getAutomationOccurrencesByDay,
} from './automation-schedule'
export type {
  AutomationOccurrenceDay,
  AutomationScheduleFields,
} from './automation-schedule'
export {
  getSDKCompactStatus,
  isPersistableSDKSystemMessage,
  type SDKCompactStatus,
} from './agent-system-message'
export {
  getSkillSlugFromEntryPath,
  createSkillActivationFromPath,
  mergeSkillActivations,
  collectSuccessfulSkillReadActivations,
  collectSkillActivations,
} from './skill-usage'
