/**
 * CollapsedSessionRail — 折叠态侧栏的会话入口列表。
 *
 * 排序与切换行为与上游 Rail 完全一致：置顶只由传入的 items 决定，点击后选中态、
 * 首字母与顺序在同一次提交内一起生效，不做任何导航延后。仅当 delegated child
 * Popover 正在打开时固定当时可见根 id，避免实时状态排序卸载或移动它的 Anchor。
 * 面板关闭后立即恢复动态顺序。
 *
 * 子会话面板的开合状态住在本组件内。不要把它提回 LeftSidebar：那个组件有几十个
 * atom 订阅和大型 useMemo，一次 hover 或面板开合会让整棵侧栏在 paint 前重渲染，
 * 点击切换会出现明显延迟。
 */

import * as React from 'react'
import { Clock, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
  type SessionMiniMapType,
} from '@/components/session-preview/SessionMiniMapPopover'
import { CollapsedDelegatedSessionsPopover } from '@/components/agent/CollapsedDelegatedSessionsPopover'
import {
  getCollapsedAgentRailVisibleItems,
  getEffectiveCollapsedRailPopoverId,
  reduceCollapsedRailPopoverState,
  type CollapsedRailPopoverState,
} from '@/lib/collapsed-agent-rail'
import type { AgentSessionMeta } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

export interface RailRecentItem {
  id: string
  title: string
  type: SessionMiniMapType
  initial: string
  active: boolean
  status: SessionIndicatorStatus
  pinned: boolean
  workspaceName?: string
  isAutomation?: boolean
  isDelegation?: boolean
  childSessions?: AgentSessionMeta[]
}

const RAIL_STATUS_CLASS: Record<SessionIndicatorStatus, string> = {
  idle: 'hidden',
  running: 'border-blue-500 animate-pulse',
  blocked: 'border-orange-500',
  completed: 'border-emerald-500',
}

function getRailItemChildCount(item: RailRecentItem): number {
  return item.childSessions?.length ?? 0
}

function RailRecentButton({
  item,
  onSelect,
  onSelectChild,
  activeSessionId,
  activeDelegationSessionId,
  agentIndicatorMap,
  open,
  onOpenChange,
  miniMapDisabled,
}: {
  item: RailRecentItem
  onSelect: (item: RailRecentItem) => void
  onSelectChild: (session: AgentSessionMeta) => void
  activeSessionId: string | null
  activeDelegationSessionId: string | null
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  open: boolean
  onOpenChange: (open: boolean) => void
  miniMapDisabled?: boolean
}): React.ReactElement {
  const hasChildren = getRailItemChildCount(item) > 0
  const preview = useSessionMiniMapHover(600, miniMapDisabled || hasChildren)
  const button = (
    <button
      ref={preview.setAnchorRef}
      type="button"
      aria-label={`打开${item.type === 'agent' ? 'Agent 会话' : 'Chat 对话'}：${item.title}`}
      onClick={() => onSelect(item)}
      onMouseEnter={preview.handleMouseEnter}
      onMouseLeave={preview.handleMouseLeave}
      className={cn(
        'relative size-10 flex items-center justify-center overflow-hidden rounded-[12px] transition-colors titlebar-no-drag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        item.active
          ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/80'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-0 border-l-[3px] rounded-l-[12px] pointer-events-none',
          RAIL_STATUS_CLASS[item.status]
        )}
      />
      {item.isAutomation
        ? <Clock size={14} className="text-foreground/40" />
        : item.isDelegation
          ? <GitBranch size={14} className="text-foreground/40" />
          : <span className="text-[13px] font-semibold leading-none">{item.initial}</span>
      }
    </button>
  )

  return (
    <>
      {item.type === 'agent' && hasChildren ? (
        <CollapsedDelegatedSessionsPopover
          parentTitle={item.title}
          childSessions={item.childSessions ?? []}
          activeSessionId={activeSessionId}
          activeDelegationSessionId={activeDelegationSessionId}
          agentIndicatorMap={agentIndicatorMap}
          open={open}
          onOpenChange={onOpenChange}
          onSelect={onSelectChild}
        >
          {button}
        </CollapsedDelegatedSessionsPopover>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{item.type === 'agent' ? 'Agent' : 'Chat'} · {item.title}</TooltipContent>
        </Tooltip>
      )}
      <SessionMiniMapPopover
        target={{
          type: item.type,
          sessionId: item.id,
          title: item.title,
          workspaceName: item.workspaceName,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </>
  )
}

export function CollapsedSessionRail({
  items,
  activeSessionId,
  activeDelegationSessionId,
  agentIndicatorMap,
  miniMapDisabled,
  onSelect,
  onSelectChild,
}: {
  items: RailRecentItem[]
  activeSessionId: string | null
  activeDelegationSessionId: string | null
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  miniMapDisabled?: boolean
  onSelect: (item: RailRecentItem) => void
  onSelectChild: (session: AgentSessionMeta) => void
}): React.ReactElement {
  // ID 与快照必须一起提交；旧面板的延迟关闭不能清理新面板的快照。
  const [popoverState, setPopoverState] = React.useState<CollapsedRailPopoverState>({
    openPopoverId: null,
    snapshotIds: null,
  })
  const { openPopoverId, snapshotIds: openSnapshotIds } = popoverState

  const popoverItemIds = React.useMemo(
    () => items.filter((item) => getRailItemChildCount(item) > 0).map((item) => item.id),
    [items],
  )
  const effectiveOpenPopoverId = getEffectiveCollapsedRailPopoverId(openPopoverId, popoverItemIds)
  const visibleItems = getCollapsedAgentRailVisibleItems(
    items,
    effectiveOpenPopoverId,
    openSnapshotIds,
  )

  React.useLayoutEffect(() => {
    if (openPopoverId !== null && effectiveOpenPopoverId === null) {
      setPopoverState((current) => reduceCollapsedRailPopoverState(current, {
        type: 'close', id: openPopoverId,
      }))
    }
  }, [effectiveOpenPopoverId, openPopoverId])

  return (
    <div className="mt-2 flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin">
      <div className="flex flex-col items-center gap-0.5 pb-2">
        {visibleItems.map((item) => (
          <RailRecentButton
            key={`${item.type}-${item.id}`}
            item={item}
            agentIndicatorMap={agentIndicatorMap}
            activeSessionId={activeSessionId}
            activeDelegationSessionId={activeDelegationSessionId}
            open={effectiveOpenPopoverId === item.id}
            onOpenChange={(nextOpen) => {
              setPopoverState((current) => reduceCollapsedRailPopoverState(current, nextOpen
                ? { type: 'open', id: item.id, snapshotIds: visibleItems.map((candidate) => candidate.id) }
                : { type: 'close', id: item.id },
              ))
            }}
            miniMapDisabled={miniMapDisabled}
            onSelect={onSelect}
            onSelectChild={onSelectChild}
          />
        ))}
      </div>
    </div>
  )
}
