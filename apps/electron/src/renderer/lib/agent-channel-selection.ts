import type { AgentRuntime } from '@proma/shared'

export function nextAgentChannelIdsAfterModelSelect(
  currentChannelIds: string[],
  selectedChannelId: string,
  runtime: AgentRuntime,
): string[] {
  if (runtime !== 'claude') return currentChannelIds
  return currentChannelIds.includes(selectedChannelId)
    ? currentChannelIds
    : [...currentChannelIds, selectedChannelId]
}
