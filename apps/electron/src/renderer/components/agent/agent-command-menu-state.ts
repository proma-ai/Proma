export interface CommandMenuSearchItem {
  label: string
  description?: string
}

export function getNextCommandMenuIndex(current: number, direction: 1 | -1, itemCount: number): number {
  if (itemCount <= 0) return 0
  return (current + direction + itemCount) % itemCount
}

export function filterCommandMenuItems<T extends CommandMenuSearchItem>(items: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items

  return items.filter((item) => (
    item.label.toLocaleLowerCase().includes(normalizedQuery) ||
    item.description?.toLocaleLowerCase().includes(normalizedQuery)
  ))
}

/**
 * The root palette owns only a standalone command prefix. This keeps literal
 * paths and Markdown such as /tmp/file from being intercepted as commands.
 */
export function shouldOpenSlashCommandMenu(text: string): boolean {
  return /^\/[^/\s]*$/.test(text)
}
