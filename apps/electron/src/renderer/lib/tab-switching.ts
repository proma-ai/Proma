const DEFAULT_TAB_MRU_LIMIT = 50

interface TabSwitchCandidate {
  id: string
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

/** 将当前 Tab 提升到最近访问队首，用于 Ctrl+Tab 在最近两个 Tab 间快速往返。 */
export function promoteTabMru(
  mru: string[],
  tabId: string | null,
  limit = DEFAULT_TAB_MRU_LIMIT,
): string[] {
  if (!tabId) return mru

  const next = [
    tabId,
    ...mru.filter((id) => id !== tabId),
  ].slice(0, Math.max(1, limit))

  return arraysEqual(mru, next) ? mru : next
}

/** 按 MRU 重新计算 Ctrl+Tab 首次命中的候选项，再映射回当前展示列表的 index。 */
export function getInitialTabSwitchIndex<T extends TabSwitchCandidate>(
  candidates: readonly T[],
  activeTabId: string | null,
  mru: readonly string[],
  direction: 1 | -1,
): number {
  if (candidates.length === 0) return -1

  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const orderedIds: string[] = []
  const seenIds = new Set<string>()

  for (const id of mru) {
    if (!candidateIds.has(id) || seenIds.has(id)) continue
    orderedIds.push(id)
    seenIds.add(id)
  }

  for (const candidate of candidates) {
    if (seenIds.has(candidate.id)) continue
    orderedIds.push(candidate.id)
    seenIds.add(candidate.id)
  }

  const activeIndex = activeTabId ? orderedIds.indexOf(activeTabId) : -1
  const targetOrderIndex = activeIndex === -1
    ? direction === 1 ? 0 : orderedIds.length - 1
    : (activeIndex + direction + orderedIds.length) % orderedIds.length
  const targetId = orderedIds[targetOrderIndex]

  return candidates.findIndex((candidate) => candidate.id === targetId)
}
