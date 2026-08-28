import type { AgentSidePanelTab } from '@/atoms/agent-atoms'

export type RightWorkspacePane = 'left' | 'right'

export interface RightWorkspaceSplitState {
  leftTab: AgentSidePanelTab
  rightTab: AgentSidePanelTab
  focusedPane: RightWorkspacePane
  /** 左侧 Pane 占内容区的比例。 */
  ratio: number
}

export interface RightWorkspaceSplitResolution {
  split: RightWorkspaceSplitState | null
  activeTab: AgentSidePanelTab
}

export function clampRightWorkspaceSplitRatio(ratio: number): number {
  return Math.max(0.3, Math.min(0.7, ratio))
}

export function clampRightWorkspaceSplitRatioForWidth(
  ratio: number,
  totalWidth: number,
  minimumPaneWidth = 320,
  dividerWidth = 8,
): number {
  const contentWidth = Math.max(0, totalWidth - dividerWidth)
  if (contentWidth === 0) return 0.5
  const minimumRatio = Math.min(0.5, Math.max(0.3, minimumPaneWidth / contentWidth))
  return Math.max(minimumRatio, Math.min(1 - minimumRatio, ratio))
}

export function getFocusedRightWorkspaceTab(split: RightWorkspaceSplitState): AgentSidePanelTab {
  return split.focusedPane === 'left' ? split.leftTab : split.rightTab
}

export function createRightWorkspaceSplit(
  activeTab: AgentSidePanelTab,
  draggedTab: AgentSidePanelTab,
  placement: RightWorkspacePane,
  ratio: number,
): RightWorkspaceSplitState | null {
  if (activeTab === draggedTab) return null
  return {
    leftTab: placement === 'left' ? draggedTab : activeTab,
    rightTab: placement === 'right' ? draggedTab : activeTab,
    focusedPane: placement,
    ratio: clampRightWorkspaceSplitRatio(ratio),
  }
}

export function focusRightWorkspaceSplitPane(
  split: RightWorkspaceSplitState,
  pane: RightWorkspacePane,
): RightWorkspaceSplitState {
  return split.focusedPane === pane ? split : { ...split, focusedPane: pane }
}

export function selectRightWorkspaceSplitTab(
  split: RightWorkspaceSplitState,
  tab: AgentSidePanelTab,
): RightWorkspaceSplitState {
  if (split.leftTab === tab) return focusRightWorkspaceSplitPane(split, 'left')
  if (split.rightTab === tab) return focusRightWorkspaceSplitPane(split, 'right')
  return split.focusedPane === 'left'
    ? { ...split, leftTab: tab }
    : { ...split, rightTab: tab }
}

export function groupRightWorkspaceTabs<T extends { id: AgentSidePanelTab }>(
  tabs: readonly T[],
  leftTab: AgentSidePanelTab,
  rightTab: AgentSidePanelTab,
): T[] {
  const groupedIds = new Set([leftTab, rightTab])
  const firstGroupIndex = tabs.findIndex((tab) => groupedIds.has(tab.id))
  if (firstGroupIndex < 0) return [...tabs]
  const group = [leftTab, rightTab]
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter((tab): tab is T => tab !== undefined)
  const remaining = tabs.filter((tab) => !groupedIds.has(tab.id))
  remaining.splice(Math.min(firstGroupIndex, remaining.length), 0, ...group)
  return remaining
}

export function placeRightWorkspaceSplitTab(
  split: RightWorkspaceSplitState,
  tab: AgentSidePanelTab,
  pane: RightWorkspacePane,
): RightWorkspaceSplitState {
  const currentPane = split.leftTab === tab ? 'left' : split.rightTab === tab ? 'right' : null
  if (currentPane === pane) return focusRightWorkspaceSplitPane(split, pane)
  if (currentPane !== null) {
    return {
      ...split,
      leftTab: split.rightTab,
      rightTab: split.leftTab,
      focusedPane: pane,
    }
  }
  return pane === 'left'
    ? { ...split, leftTab: tab, focusedPane: 'left' }
    : { ...split, rightTab: tab, focusedPane: 'right' }
}

export function collapseRightWorkspaceSplit(split: RightWorkspaceSplitState): AgentSidePanelTab {
  return getFocusedRightWorkspaceTab(split)
}

export function sanitizeRightWorkspaceSplit(
  split: RightWorkspaceSplitState,
  availableTabs: ReadonlySet<AgentSidePanelTab>,
  fallbackTab: AgentSidePanelTab = 'files',
): RightWorkspaceSplitResolution {
  const available = [...availableTabs]
  const hasLeft = availableTabs.has(split.leftTab)
  const hasRight = availableTabs.has(split.rightTab)
  if (hasLeft && hasRight && split.leftTab !== split.rightTab) {
    return { split, activeTab: getFocusedRightWorkspaceTab(split) }
  }
  if (available.length < 2) {
    const activeTab = hasLeft
      ? split.leftTab
      : hasRight
        ? split.rightTab
        : availableTabs.has(fallbackTab)
          ? fallbackTab
          : available[0] ?? fallbackTab
    return { split: null, activeTab }
  }

  const leftTab = hasLeft
    ? split.leftTab
    : available.find((tab) => tab !== (hasRight ? split.rightTab : undefined)) ?? available[0]!
  const rightTab = hasRight && split.rightTab !== leftTab
    ? split.rightTab
    : available.find((tab) => tab !== leftTab) ?? available[1]!
  const repaired = { ...split, leftTab, rightTab }
  return { split: repaired, activeTab: getFocusedRightWorkspaceTab(repaired) }
}
