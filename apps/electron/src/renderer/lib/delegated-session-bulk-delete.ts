import type { AgentSessionMeta } from '@proma/shared'

export type DelegatedChildCandidate = Pick<
  AgentSessionMeta,
  'id' | 'parentSessionId' | 'sourceDelegationId'
>

export interface DelegatedSessionBulkSelection {
  parentSessionId: string
  /** 进入多选模式时的稳定顺序；新出现的直接子会话只追加，不自动选中。 */
  childOrder: string[]
  selectedIds: string[]
}

export function shouldShowDelegatedSessionBulkDeleteAction(childCount: number): boolean {
  return childCount >= 2
}

export interface DelegatedSessionBulkDeleteActionTarget {
  parentSessionId: string
  preselectedSessionId?: string
}

export function getDelegatedSessionBulkDeleteActionTarget(
  session: DelegatedChildCandidate,
  directChildCount: number,
  siblingCount = 0,
): DelegatedSessionBulkDeleteActionTarget | null {
  if (shouldShowDelegatedSessionBulkDeleteAction(directChildCount)) {
    return { parentSessionId: session.id }
  }
  if (
    session.parentSessionId
    && session.sourceDelegationId
    && shouldShowDelegatedSessionBulkDeleteAction(siblingCount)
  ) {
    return {
      parentSessionId: session.parentSessionId,
      preselectedSessionId: session.id,
    }
  }
  return null
}

export function shouldRenderDelegatedSessionBulkActions(
  selection: DelegatedSessionBulkSelection | null,
  parentSessionId: string,
): selection is DelegatedSessionBulkSelection {
  return selection?.parentSessionId === parentSessionId
}

function directChildIds(
  parentSessionId: string,
  sessions: readonly DelegatedChildCandidate[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const session of sessions) {
    if (
      session.parentSessionId !== parentSessionId
      || !session.sourceDelegationId
      || seen.has(session.id)
    ) continue
    seen.add(session.id)
    result.push(session.id)
  }
  return result
}

export function createDelegatedSessionBulkSelection(
  parentSessionId: string,
  visibleSessions: readonly DelegatedChildCandidate[],
  preselectedSessionId?: string,
): DelegatedSessionBulkSelection {
  const childOrder = directChildIds(parentSessionId, visibleSessions)
  return {
    parentSessionId,
    childOrder,
    selectedIds: preselectedSessionId && childOrder.includes(preselectedSessionId)
      ? [preselectedSessionId]
      : [],
  }
}

export function reconcileDelegatedSessionBulkSelection(
  selection: DelegatedSessionBulkSelection,
  visibleSessions: readonly DelegatedChildCandidate[],
  busyIds: ReadonlySet<string>,
): DelegatedSessionBulkSelection {
  const currentIds = directChildIds(selection.parentSessionId, visibleSessions)
  const currentSet = new Set(currentIds)
  const stableIds = selection.childOrder.filter((id) => currentSet.has(id))
  const stableSet = new Set(stableIds)
  const appendedIds = currentIds.filter((id) => !stableSet.has(id))
  const childOrder = [...stableIds, ...appendedIds]
  const childSet = new Set(childOrder)
  const selectedIds = selection.selectedIds.filter((id) => childSet.has(id) && !busyIds.has(id))

  if (
    childOrder.length === selection.childOrder.length
    && childOrder.every((id, index) => id === selection.childOrder[index])
    && selectedIds.length === selection.selectedIds.length
    && selectedIds.every((id, index) => id === selection.selectedIds[index])
  ) return selection

  return { ...selection, childOrder, selectedIds }
}

export function getSelectableDelegatedSessionIds(
  selection: DelegatedSessionBulkSelection,
  busyIds: ReadonlySet<string>,
): string[] {
  return selection.childOrder.filter((id) => !busyIds.has(id))
}

export function toggleDelegatedSessionBulkSelection(
  selection: DelegatedSessionBulkSelection,
  sessionId: string,
  busyIds: ReadonlySet<string>,
): DelegatedSessionBulkSelection {
  if (!selection.childOrder.includes(sessionId) || busyIds.has(sessionId)) return selection

  const selected = new Set(selection.selectedIds)
  if (selected.has(sessionId)) selected.delete(sessionId)
  else selected.add(sessionId)

  return {
    ...selection,
    selectedIds: selection.childOrder.filter((id) => selected.has(id)),
  }
}

export function selectAllDelegatedSessions(
  selection: DelegatedSessionBulkSelection,
  busyIds: ReadonlySet<string>,
): DelegatedSessionBulkSelection {
  const selectedIds = getSelectableDelegatedSessionIds(selection, busyIds)
  return selectedIds.length === selection.selectedIds.length
    && selectedIds.every((id, index) => id === selection.selectedIds[index])
    ? selection
    : { ...selection, selectedIds }
}
