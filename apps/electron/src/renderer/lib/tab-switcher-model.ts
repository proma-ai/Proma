import type { AgentSessionMeta, AgentWorkspace, ConversationMeta } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

export type SwitchSectionId = 'collaboration' | 'recent'
export type SwitchCandidateType = 'chat' | 'agent'

export interface SwitchCandidate {
  id: string
  type: SwitchCandidateType
  title: string
  updatedAt: number
  status: SessionIndicatorStatus
  workspaceId?: string
  workspaceName?: string
  isDelegation?: boolean
}

export interface SwitchSection {
  id: SwitchSectionId
  title: string
  description: string
  candidates: SwitchCandidate[]
}

export interface SwitcherModel {
  sections: SwitchSection[]
  candidates: SwitchCandidate[]
}

export interface BuildTabSwitcherModelInput {
  activeSessionId: string | null
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  agentSessions: readonly AgentSessionMeta[]
  agentWorkspaces: readonly AgentWorkspace[]
  conversations: readonly ConversationMeta[]
  draftSessionIds: ReadonlySet<string>
  streamingConversationIds: ReadonlySet<string>
  tabMru: readonly string[]
  unviewedCompletedIds: ReadonlySet<string>
}

/**
 * 构建 Ctrl+Tab 的候选模型。候选只来自 Chat 与 Agent 会话，
 * 不读取顶部 Tab，因此旧 Scratch Pad 不可能作为切换候选复活。
 */
export function buildTabSwitcherModel({
  activeSessionId,
  agentIndicatorMap,
  agentSessions,
  agentWorkspaces,
  conversations,
  draftSessionIds,
  streamingConversationIds,
  tabMru,
  unviewedCompletedIds,
}: BuildTabSwitcherModelInput): SwitcherModel {
  const workspaceNameById = new Map(agentWorkspaces.map((workspace) => [workspace.id, workspace.name]))
  const buildAgentCandidate = (session: AgentSessionMeta): SwitchCandidate => {
    const status = agentIndicatorMap.get(session.id)
      ?? (unviewedCompletedIds.has(session.id) ? 'completed' : 'idle')
    return {
      id: session.id,
      type: 'agent',
      title: session.title || '新 Agent 会话',
      updatedAt: session.updatedAt,
      status,
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceId ? workspaceNameById.get(session.workspaceId) : undefined,
      isDelegation: !!session.sourceDelegationId,
    }
  }

  const chatCandidates = conversations
    .filter((conversation) => !conversation.archived && !draftSessionIds.has(conversation.id))
    .map((conversation): SwitchCandidate => ({
      id: conversation.id,
      type: 'chat',
      title: conversation.title || '新对话',
      updatedAt: conversation.updatedAt,
      status: streamingConversationIds.has(conversation.id) ? 'running' : 'idle',
    }))

  const agentCandidates = agentSessions
    .filter((session) => !session.archived && !session.isDraft && !draftSessionIds.has(session.id))
    .map(buildAgentCandidate)

  const allCandidates = [...chatCandidates, ...agentCandidates]
  const candidateById = new Map(allCandidates.map((candidate) => [candidate.id, candidate]))
  const activeAgentSession = activeSessionId
    ? agentSessions.find((session) => session.id === activeSessionId)
    : undefined
  const relatedParentSessionId = activeAgentSession?.parentSessionId ?? activeAgentSession?.id
  const relatedDelegationIds = new Set<string>()
  if (activeAgentSession && relatedParentSessionId) {
    relatedDelegationIds.add(relatedParentSessionId)
    for (const session of agentSessions) {
      if (session.parentSessionId === relatedParentSessionId) {
        relatedDelegationIds.add(session.id)
      }
    }
  }
  const relatedCandidates = Array.from(relatedDelegationIds)
    .map((id) => candidateById.get(id))
    .filter((candidate): candidate is SwitchCandidate => !!candidate)
    .sort((a, b) => {
      if (a.id === relatedParentSessionId) return -1
      if (b.id === relatedParentSessionId) return 1
      return b.updatedAt - a.updatedAt
    })
  const shouldShowCollaborationSection = relatedCandidates.length > 1
  const relatedCandidateIds = new Set(
    shouldShowCollaborationSection ? relatedCandidates.map((candidate) => candidate.id) : [],
  )

  const mruIndex = new Map(tabMru.map((id, index) => [id, index]))
  const recentCandidates = allCandidates
    .filter((candidate) => !relatedCandidateIds.has(candidate.id))
  recentCandidates.sort((a, b) => {
    const ai = mruIndex.get(a.id)
    const bi = mruIndex.get(b.id)
    if (ai !== undefined && bi !== undefined) return ai - bi
    if (ai !== undefined) return -1
    if (bi !== undefined) return 1
    return b.updatedAt - a.updatedAt
  })

  const sections: SwitchSection[] = []
  if (shouldShowCollaborationSection) {
    sections.push({
      id: 'collaboration',
      title: '当前协作',
      description: '父会话与子会话',
      candidates: relatedCandidates,
    })
  }
  if (recentCandidates.length > 0) {
    sections.push({
      id: 'recent',
      title: '最近访问',
      description: '按访问顺序排列',
      candidates: recentCandidates,
    })
  }

  return {
    sections,
    candidates: sections.flatMap((section) => section.candidates),
  }
}
