/**
 * TabSwitcher — Ctrl+Tab 会话快速切换器
 *
 * 顶部只保留“草稿 + 当前会话”后，快捷键不再依赖顶部 Tab 数量。
 * 列表按“工作中优先、最近更新兜底”分区展示，键盘和鼠标共享同一套选择模型。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { AgentSessionMeta, ConversationMeta } from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  activeTabIdAtom,
  openTab,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import {
  conversationsAtom,
  currentConversationIdAtom,
  streamingConversationIdsAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionIndicatorMapAtom,
  agentSessionsAtom,
  agentWorkspacesAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { workingSessionGroupsAtom } from '@/atoms/working-atoms'

type SwitchSectionId = 'working' | 'recent'
type SwitchCandidateType = 'chat' | 'agent'

interface SwitchCandidate {
  id: string
  type: SwitchCandidateType
  title: string
  updatedAt: number
  status: SessionIndicatorStatus
  workspaceId?: string
  workspaceName?: string
}

interface SwitchSection {
  id: SwitchSectionId
  title: string
  description: string
  candidates: SwitchCandidate[]
}

interface SwitcherModel {
  sections: SwitchSection[]
  candidates: SwitchCandidate[]
}

export function TabSwitcher(): ReactElement | null {
  const tabs = useAtomValue(tabsAtom)
  const setTabs = useSetAtom(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)

  const conversations = useAtomValue(conversationsAtom)
  const streamingConversationIds = useAtomValue(streamingConversationIdsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const agentIndicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const unviewedCompletedIds = useAtomValue(unviewedCompletedSessionIdsAtom)
  const workingGroups = useAtomValue(workingSessionGroupsAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)

  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)

  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const switcherModel = useMemo<SwitcherModel>(() => {
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
      }
    }

    const workingCandidates = [
      ...workingGroups.todo,
      ...workingGroups.running,
      ...workingGroups.done,
    ].map(buildAgentCandidate)
    const workingIds = new Set(workingCandidates.map((candidate) => candidate.id))

    const chatCandidates = conversations
      .filter((conversation) => !conversation.archived && !draftSessionIds.has(conversation.id))
      .map((conversation: ConversationMeta): SwitchCandidate => ({
        id: conversation.id,
        type: 'chat',
        title: conversation.title || '新对话',
        updatedAt: conversation.updatedAt,
        status: streamingConversationIds.has(conversation.id) ? 'running' : 'idle',
      }))

    const agentCandidates = agentSessions
      .filter((session) => !session.archived && !draftSessionIds.has(session.id) && !workingIds.has(session.id))
      .map(buildAgentCandidate)

    const recentCandidates = [...chatCandidates, ...agentCandidates]
      .sort((a, b) => b.updatedAt - a.updatedAt)

    const sections: SwitchSection[] = []
    if (workingCandidates.length > 0) {
      sections.push({
        id: 'working',
        title: '工作中',
        description: '等待处理、运行中、完成待查看',
        candidates: workingCandidates,
      })
    }
    if (recentCandidates.length > 0) {
      sections.push({
        id: 'recent',
        title: '最近更新',
        description: '所有工作区的 Chat 和 Agent',
        candidates: recentCandidates,
      })
    }

    return {
      sections,
      candidates: sections.flatMap((section) => section.candidates),
    }
  }, [
    agentIndicatorMap,
    agentSessions,
    agentWorkspaces,
    conversations,
    draftSessionIds,
    streamingConversationIds,
    unviewedCompletedIds,
    workingGroups,
  ])

  // Refs 用于事件回调中读取最新值，避免全局键盘监听闭包过期。
  const isOpenRef = useRef(false)
  const selectedIndexRef = useRef(0)
  const activeTabIdRef = useRef<string | null>(activeTabId)
  const candidatesRef = useRef<SwitchCandidate[]>(switcherModel.candidates)
  const tabsRef = useRef(tabs)

  isOpenRef.current = isOpen
  selectedIndexRef.current = selectedIndex
  activeTabIdRef.current = activeTabId
  candidatesRef.current = switcherModel.candidates
  tabsRef.current = tabs

  const closeSwitcher = useCallback((): void => {
    setIsOpen(false)
    isOpenRef.current = false
  }, [])

  const activateCandidate = useCallback(
    (candidate: SwitchCandidate): void => {
      const nextTab = openTab(tabsRef.current, {
        type: candidate.type,
        sessionId: candidate.id,
        title: candidate.title,
      })
      setTabs(nextTab.tabs)
      setActiveTabId(nextTab.activeTabId)

      if (candidate.type === 'chat') {
        setAppMode('chat')
        setCurrentConversationId(candidate.id)
        setCurrentAgentSessionId(null)
        return
      }

      setAppMode('agent')
      setCurrentAgentSessionId(candidate.id)
      setCurrentConversationId(null)

      setUnviewedCompleted((prev) => {
        if (!prev.has(candidate.id)) return prev
        const next = new Set(prev)
        next.delete(candidate.id)
        return next
      })

      if (candidate.workspaceId) {
        setCurrentAgentWorkspaceId(candidate.workspaceId)
        window.electronAPI
          .updateSettings({ agentWorkspaceId: candidate.workspaceId })
          .catch(console.error)
      }
    },
    [
      setActiveTabId,
      setAppMode,
      setCurrentAgentSessionId,
      setCurrentAgentWorkspaceId,
      setCurrentConversationId,
      setTabs,
      setUnviewedCompleted,
    ],
  )

  const activateAndClose = useCallback((candidate: SwitchCandidate): void => {
    activateCandidate(candidate)
    closeSwitcher()
  }, [activateCandidate, closeSwitcher])

  useEffect(() => {
    const getNextIndex = (direction: 1 | -1): number => {
      const candidates = candidatesRef.current
      if (candidates.length === 0) return -1
      const currentIndex = candidates.findIndex((candidate) => candidate.id === activeTabIdRef.current)
      if (currentIndex === -1) return direction === 1 ? 0 : candidates.length - 1
      return (currentIndex + direction + candidates.length) % candidates.length
    }

    const hasAlternateTarget = (): boolean => {
      const candidates = candidatesRef.current
      return candidates.some((candidate) => candidate.id !== activeTabIdRef.current)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isOpenRef.current) {
        event.preventDefault()
        closeSwitcher()
        return
      }

      // macOS 上这里的 Ctrl 是物理 Control 键，不等同于 Cmd。
      if (event.key !== 'Tab' || !event.ctrlKey || event.metaKey || event.altKey) return

      event.preventDefault()
      event.stopPropagation()

      const candidates = candidatesRef.current
      if (candidates.length === 0 || !hasAlternateTarget()) return

      const direction: 1 | -1 = event.shiftKey ? -1 : 1
      if (!isOpenRef.current) {
        const nextIndex = getNextIndex(direction)
        if (nextIndex < 0) return
        setIsOpen(true)
        isOpenRef.current = true
        setSelectedIndex(nextIndex)
        selectedIndexRef.current = nextIndex
        return
      }

      const nextIndex = (selectedIndexRef.current + direction + candidates.length) % candidates.length
      setSelectedIndex(nextIndex)
      selectedIndexRef.current = nextIndex
    }

    const confirmSelection = (): void => {
      if (!isOpenRef.current) return
      const selectedCandidate = candidatesRef.current[selectedIndexRef.current]
      if (selectedCandidate) activateCandidate(selectedCandidate)
      closeSwitcher()
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Control') confirmSelection()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', confirmSelection)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', confirmSelection)
    }
  }, [activateCandidate, closeSwitcher])

  if (!isOpen || switcherModel.candidates.length === 0) return null

  const safeIndex = Math.min(selectedIndex, switcherModel.candidates.length - 1)
  let globalIndex = 0

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" />

      <div className="relative bg-popover/95 backdrop-blur-md border border-border/50 rounded-xl shadow-2xl min-w-[420px] max-w-[540px] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-border/40 bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium text-foreground">切换会话</span>
            <span className="shrink-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 text-primary font-medium">
              工作中优先
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Kbd>Ctrl</Kbd>
            <span>+</span>
            <Kbd>Tab</Kbd>
            <span className="opacity-60 ml-1">循环</span>
          </div>
        </div>

        <div className="py-1.5 max-h-[420px] overflow-y-auto scrollbar-thin">
          {switcherModel.sections.map((section, sectionIndex) => (
            <div key={section.id}>
              {sectionIndex > 0 && (
                <div className="mx-5 my-1.5 h-px bg-border/50" aria-hidden="true" />
              )}
              <div className="px-5 pt-1 pb-1 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium text-foreground/55">{section.title}</span>
                <span className="text-[10px] text-muted-foreground truncate">{section.description}</span>
              </div>
              {section.candidates.map((candidate) => {
                const index = globalIndex
                globalIndex += 1
                return (
                  <SwitcherCandidateRow
                    key={`${candidate.type}-${candidate.id}`}
                    candidate={candidate}
                    active={index === safeIndex}
                    onMouseEnter={() => {
                      setSelectedIndex(index)
                      selectedIndexRef.current = index
                    }}
                    onClick={() => activateAndClose(candidate)}
                  />
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-2 border-t border-border/40 bg-muted/30 text-[11px] text-muted-foreground">
          <span className="truncate">松开 Ctrl 确认，也可以直接点击选择</span>
          <div className="flex items-center gap-1 shrink-0">
            <Kbd>Esc</Kbd>
            <span className="opacity-60">取消</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SwitcherCandidateRow({
  candidate,
  active,
  onMouseEnter,
  onClick,
}: {
  candidate: SwitchCandidate
  active: boolean
  onMouseEnter: () => void
  onClick: () => void
}): ReactElement {
  const indicatorColor = getIndicatorColor(candidate.status)
  const indicatorPulse = candidate.status === 'running' || candidate.status === 'blocked'

  return (
    <button
      type="button"
      className={cn(
        'relative flex items-center gap-3 w-full pl-5 pr-5 py-2.5 text-[15px] text-left cursor-default transition-colors',
        active ? 'bg-primary/15 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/40',
      )}
      onMouseEnter={onMouseEnter}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={onClick}
    >
      {indicatorColor && (
        <span
          className={cn(
            'absolute left-1.5 top-2 bottom-2 w-[2px] rounded-full',
            indicatorColor,
            indicatorPulse && 'animate-pulse',
          )}
          aria-hidden="true"
        />
      )}
      <span className="w-10 shrink-0 text-[10px] leading-4 text-center rounded-full bg-foreground/[0.06] text-foreground/45 font-medium">
        {candidate.type === 'agent' ? 'Agent' : 'Chat'}
      </span>
      <span className="flex-1 min-w-0 truncate">{candidate.title}</span>
      {candidate.workspaceName && (
        <span className="shrink-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 workspace-badge font-medium truncate max-w-[110px]">
          {candidate.workspaceName}
        </span>
      )}
    </button>
  )
}

function Kbd({ children }: { children: ReactNode }): ReactElement {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded border border-border/60 bg-background/80 text-[10px] font-medium text-foreground/80 shadow-sm">
      {children}
    </kbd>
  )
}

function getIndicatorColor(status: SessionIndicatorStatus): string | undefined {
  if (status === 'idle') return undefined
  if (status === 'completed') return 'bg-green-500'
  if (status === 'blocked') return 'bg-orange-500'
  return 'bg-blue-500'
}
