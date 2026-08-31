import type {
  AgentMessageSearchOptions,
  AgentMessageSearchResult,
  MessageSearchResult,
  SearchMatchKind,
} from '@proma/shared'
import { findBestSearchMatch } from '@proma/shared'

export interface SearchableConversation {
  id: string
  title: string
  updatedAt: number
  archived?: boolean
}

export interface SearchableAgentSession extends SearchableConversation {
  workspaceId?: string
}

export interface GlobalTitleResult {
  id: string
  title: string
  type: 'chat' | 'agent'
  archived?: boolean
  updatedAt: number
  matchKind: SearchMatchKind
  matchScore: number
}

export interface GlobalContentResult extends GlobalTitleResult {
  messageId: string
  snippet: string
  matchStart: number
  matchLength: number
}

export interface GlobalSearchRequest {
  includeChat: boolean
  agentOptions?: AgentMessageSearchOptions
}

export interface SearchScopePlan {
  workspaceIds: string[]
  includeTitleMatches: boolean
}

export interface BuildSearchScopePlanInput {
  projectWorkspaceId?: string
  selectedWorkspaceIds: string[]
}

export interface CreateGlobalTitleResultsInput {
  query: string
  conversations: SearchableConversation[]
  agentSessions: SearchableAgentSession[]
  selectedWorkspaceIds: string[]
  limit?: number
}

export interface MergeGlobalContentResultsInput {
  query: string
  titleResultKeys: ReadonlySet<string>
  chatResults: MessageSearchResult[]
  agentResults: AgentMessageSearchResult[]
}

function compareGlobalSearchResults(left: GlobalTitleResult, right: GlobalTitleResult): number {
  const archiveOrder = Number(Boolean(left.archived)) - Number(Boolean(right.archived))
  if (archiveOrder !== 0) return archiveOrder

  const exactOrder = Number(right.matchKind === 'exact') - Number(left.matchKind === 'exact')
  if (exactOrder !== 0) return exactOrder

  return right.updatedAt - left.updatedAt
    || right.matchScore - left.matchScore
    || getGlobalSearchResultKey(left.type, left.id).localeCompare(getGlobalSearchResultKey(right.type, right.id))
}

export function getGlobalSearchResultKey(type: 'chat' | 'agent', id: string): string {
  return `${type}:${id}`
}

/** 项目菜单固定单项目范围；全局入口保留用户多选并继续展示标题匹配。 */
export function buildSearchScopePlan(input: BuildSearchScopePlanInput): SearchScopePlan {
  if (input.projectWorkspaceId) {
    return {
      workspaceIds: [input.projectWorkspaceId],
      includeTitleMatches: false,
    }
  }

  return {
    workspaceIds: input.selectedWorkspaceIds,
    includeTitleMatches: true,
  }
}

/** 将项目多选状态转换为 IPC 搜索范围；空选择代表搜索全部。 */
export function buildGlobalSearchRequest(selectedWorkspaceIds: string[]): GlobalSearchRequest {
  const workspaceIds = [...new Set(selectedWorkspaceIds.filter(Boolean))]
  if (workspaceIds.length === 0) {
    return { includeChat: true, agentOptions: undefined }
  }

  return {
    includeChat: false,
    agentOptions: { workspaceIds },
  }
}

/** 合并标题匹配，统一按归档状态、匹配质量和会话更新时间排序。 */
export function createGlobalTitleResults(input: CreateGlobalTitleResultsInput): GlobalTitleResult[] {
  const selectedWorkspaceIds = new Set(input.selectedWorkspaceIds)
  const hasProjectScope = selectedWorkspaceIds.size > 0
  const chatResults: GlobalTitleResult[] = hasProjectScope
    ? []
    : input.conversations
      .flatMap((conversation) => {
        const match = findBestSearchMatch(conversation.title, input.query)
        return match ? [{
          id: conversation.id,
          title: conversation.title,
          type: 'chat' as const,
          archived: conversation.archived,
          updatedAt: conversation.updatedAt,
          matchKind: match.kind,
          matchScore: match.score,
        }] : []
      })
  const agentResults: GlobalTitleResult[] = input.agentSessions
    .filter((session) => !hasProjectScope || (session.workspaceId && selectedWorkspaceIds.has(session.workspaceId)))
    .flatMap((session) => {
      const match = findBestSearchMatch(session.title, input.query)
      return match ? [{
        id: session.id,
        title: session.title,
        type: 'agent' as const,
        archived: session.archived,
        updatedAt: session.updatedAt,
        matchKind: match.kind,
        matchScore: match.score,
      }] : []
    })

  return [...chatResults, ...agentResults]
    .sort(compareGlobalSearchResults)
    .slice(0, input.limit ?? 20)
}

/** 将两种会话的正文命中映射为统一格式，并复用项目搜索的分级排序。 */
export function mergeGlobalContentResults(input: MergeGlobalContentResultsInput): GlobalContentResult[] {
  const chatResults: GlobalContentResult[] = input.chatResults
    .filter((result) => !input.titleResultKeys.has(getGlobalSearchResultKey('chat', result.conversationId)))
    .flatMap((result) => {
      const match = findBestSearchMatch(result.snippet, input.query)
      return match ? [{
        id: result.conversationId,
        title: result.conversationTitle,
        type: 'chat' as const,
        messageId: result.messageId,
        snippet: result.snippet,
        matchStart: result.matchStart,
        matchLength: result.matchLength,
        archived: result.archived,
        updatedAt: result.updatedAt,
        matchKind: match.kind,
        matchScore: match.score,
      }] : []
    })
  const agentResults: GlobalContentResult[] = input.agentResults
    .filter((result) => !input.titleResultKeys.has(getGlobalSearchResultKey('agent', result.sessionId)))
    .flatMap((result) => {
      const match = findBestSearchMatch(result.snippet, input.query)
      return match ? [{
        id: result.sessionId,
        title: result.sessionTitle,
        type: 'agent' as const,
        messageId: result.messageId,
        snippet: result.snippet,
        matchStart: result.matchStart,
        matchLength: result.matchLength,
        archived: result.archived,
        updatedAt: result.updatedAt,
        matchKind: match.kind,
        matchScore: match.score,
      }] : []
    })

  return [...chatResults, ...agentResults]
    .sort(compareGlobalSearchResults)
}
