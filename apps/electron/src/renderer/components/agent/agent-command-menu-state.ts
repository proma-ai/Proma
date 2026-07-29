export interface CommandMenuSearchItem {
  id?: string
  label: string
  description?: string
}

export interface SessionReferenceDescriptionInput {
  workspaceName?: string
  workspaceSlug?: string
  snippet?: string
}

export function getNextCommandMenuIndex(current: number, direction: 1 | -1, itemCount: number): number {
  if (itemCount <= 0) return 0
  return (current + direction + itemCount) % itemCount
}

export function filterCommandMenuItems<T extends CommandMenuSearchItem>(items: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items

  return items.filter((item) => (
    item.id?.toLocaleLowerCase().includes(normalizedQuery) ||
    item.label.toLocaleLowerCase().includes(normalizedQuery) ||
    item.description?.toLocaleLowerCase().includes(normalizedQuery)
  ))
}

/**
 * 从命令根页进入子页时，保留根页筛选词但不把它误当作资源搜索词。
 */
export function getCommandMenuChildQuery(query: string, pageEntryQuery: string): string {
  return query.startsWith(pageEntryQuery)
    ? query.slice(pageEntryQuery.length)
    : query
}

export function formatSessionReferenceDescription(input: SessionReferenceDescriptionInput): string | undefined {
  const workspace = input.workspaceName
    ? input.workspaceSlug && input.workspaceSlug !== input.workspaceName
      ? `${input.workspaceName} (${input.workspaceSlug})`
      : input.workspaceName
    : input.workspaceSlug
  const parts = [workspace ? `工作区：${workspace}` : undefined, input.snippet]
    .filter((part): part is string => Boolean(part))

  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * 只校验当前 TipTap suggestion 匹配到的 slash token；不能用整篇文档
 * 判断，否则前文的普通 `/` 会阻塞当前位置再次调用命令菜单。
 */
export function shouldOpenSlashCommandMenu(token: string): boolean {
  return /^\/[^/\s]*$/.test(token)
}

/**
 * 在 TipTap 已匹配到当前 slash token 后，排除其中位于 ASCII 路径或 URL
 * 片段内的 `/`。中文正文不强制要求空格，仍可直接输入 `/` 调用菜单。
 */
export function shouldOpenSlashCommandMenuInContext(prefix: string, token: string): boolean {
  if (!shouldOpenSlashCommandMenu(token)) return false

  const currentRun = `${prefix}${token}`
    .split(/[\s,.;!?，。！？；、]/u)
    .at(-1) ?? ''
  const triggerIndex = currentRun.lastIndexOf('/')
  if (triggerIndex === -1) return false

  const beforeTrigger = currentRun.slice(0, triggerIndex)
  if (!beforeTrigger) return true
  if (beforeTrigger.includes('/')) return false

  // `foo/bar`、`C:/path`、`https:/` 等 ASCII 片段视为普通路径/URL；
  // 非 ASCII 正文（如 `继续调用/`）则保留中文无空格调用体验。
  return !/[\x00-\x7F]/.test(beforeTrigger)
}
