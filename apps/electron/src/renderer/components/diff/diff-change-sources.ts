import type { ChangeSource } from '@proma/shared'

export interface DiffChangeSourceEntry {
  source?: ChangeSource
}

/** 改动来源按稳定顺序展示，避免筛选或刷新时 badge 跳动。 */
const DIFF_CHANGE_SOURCE_ORDER: readonly ChangeSource[] = [
  'session',
  'workspace',
  'both',
  'none',
]

/** 文件来源 badge 的颜色和文案。 */
export const DIFF_CHANGE_SOURCE_CONFIG: Record<ChangeSource, { color: string; label: string }> = {
  session: { color: 'bg-blue-500/10 text-blue-500', label: '会话文件' },
  workspace: { color: 'bg-purple-500/10 text-purple-500', label: '项目文件' },
  both: { color: 'bg-cyan-500/10 text-cyan-500', label: '会话+项目文件' },
  none: { color: 'bg-muted text-muted-foreground', label: '附加目录文件' },
}

/** 聚合一个 Git 仓库内的来源类型；未追踪文件不会伪造来源。 */
export function collectDiffChangeSources(entries: readonly DiffChangeSourceEntry[]): ChangeSource[] {
  const sources = new Set<ChangeSource>()
  for (const entry of entries) {
    if (entry.source) sources.add(entry.source)
  }
  return DIFF_CHANGE_SOURCE_ORDER.filter((source) => sources.has(source))
}
