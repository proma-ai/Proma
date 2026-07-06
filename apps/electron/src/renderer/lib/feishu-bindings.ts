import type { FeishuChatBinding } from '@proma/shared'

export type FeishuBindingViewMode = 'active' | 'archived'
export type FeishuBindingTypeFilter = 'all' | 'group' | 'p2p'
export type FeishuBindingSourceFilter = 'all' | 'feishu' | 'session-mirror'

export interface FeishuBindingFilters {
  viewMode: FeishuBindingViewMode
  chatType: FeishuBindingTypeFilter
  source: FeishuBindingSourceFilter
  query: string
}

export interface GroupedFeishuBindings {
  groupBindings: FeishuChatBinding[]
  p2pBindings: FeishuChatBinding[]
}

export const FEISHU_BINDING_PAGE_SIZE = 30

function getBindingSearchText(binding: FeishuChatBinding): string {
  return [
    binding.groupName,
    binding.chatId,
    binding.userId,
    binding.sessionId,
    binding.workspaceId,
    binding.source,
  ].filter(Boolean).join(' ').toLowerCase()
}

function getBindingTime(binding: FeishuChatBinding): number {
  return binding.lastUsedAt ?? binding.createdAt
}

export function filterFeishuBindings(
  bindings: FeishuChatBinding[],
  filters: FeishuBindingFilters,
): FeishuChatBinding[] {
  const query = filters.query.trim().toLowerCase()
  const archived = filters.viewMode === 'archived'

  return bindings
    .filter((binding) => !!binding.archived === archived)
    .filter((binding) => filters.chatType === 'all' || (binding.chatType ?? 'p2p') === filters.chatType)
    .filter((binding) => filters.source === 'all' || binding.source === filters.source)
    .filter((binding) => !query || getBindingSearchText(binding).includes(query))
    .sort((a, b) => getBindingTime(b) - getBindingTime(a))
}

export function groupFeishuBindings(bindings: FeishuChatBinding[]): GroupedFeishuBindings {
  return {
    groupBindings: bindings.filter((binding) => binding.chatType === 'group'),
    p2pBindings: bindings.filter((binding) => binding.chatType !== 'group'),
  }
}
