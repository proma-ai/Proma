/**
 * 左侧 Agent 会话行拖入输入框时使用的内部拖放协议。
 * 自定义 MIME 用于可靠识别来源，text/plain 仅作为宿主兼容兜底。
 */

export const SESSION_REFERENCE_DRAG_MIME = 'application/x-proma-session-reference'

export interface SessionReferenceDragItem {
  sessionId: string
  title: string
}

let activeSessionReferenceDragId: string | null = null

export function setSessionReferenceDragData(
  dataTransfer: DataTransfer,
  item: SessionReferenceDragItem,
): void {
  activeSessionReferenceDragId = item.sessionId
  try {
    dataTransfer.setData(SESSION_REFERENCE_DRAG_MIME, JSON.stringify(item))
    dataTransfer.setData(
      'text/plain',
      `&session:${item.sessionId}::${encodeURIComponent(item.title)}`,
    )
    dataTransfer.effectAllowed = 'copy'
  } catch (error) {
    activeSessionReferenceDragId = null
    throw error
  }
}

export function isSessionReferenceDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(SESSION_REFERENCE_DRAG_MIME)
}

/** dragover 无法读取 payload，只能结合可枚举的 MIME type 使用 dragstart 内存态。 */
export function getActiveSessionReferenceDragId(dataTransfer: DataTransfer): string | null {
  return isSessionReferenceDrag(dataTransfer) ? activeSessionReferenceDragId : null
}

export function clearSessionReferenceDragState(): void {
  activeSessionReferenceDragId = null
}

export function canReferenceDraggedSession(
  item: SessionReferenceDragItem,
  currentSessionId: string,
): boolean {
  return item.sessionId !== currentSessionId
}

export function getSessionReferenceDragData(
  dataTransfer: DataTransfer,
): SessionReferenceDragItem | null {
  const raw = dataTransfer.getData(SESSION_REFERENCE_DRAG_MIME)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isSessionReferenceDragItem(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 侧栏三点菜单「引用此会话」触发的事件名，与拖拽走不同入口但复用同一份 mention 插入逻辑。
 * detail 携带目标会话 id（当前主视图打开的 Agent 会话）与被引用的会话信息；
 * 由持有 RichTextInput ref 的 AgentView 监听后回写 inserted，调用方据此决定是否提示用户。
 */
export const INSERT_SESSION_REFERENCE_MENTION_EVENT = 'proma:insert-session-reference-mention'

export interface InsertSessionReferenceMentionDetail {
  targetSessionId: string
  item: SessionReferenceDragItem
  inserted: boolean
}

export function insertSessionReferenceMention(
  targetSessionId: string,
  item: SessionReferenceDragItem,
): boolean {
  const detail: InsertSessionReferenceMentionDetail = { targetSessionId, item, inserted: false }
  window.dispatchEvent(
    new CustomEvent<InsertSessionReferenceMentionDetail>(INSERT_SESSION_REFERENCE_MENTION_EVENT, { detail }),
  )
  return detail.inserted
}

function isSessionReferenceDragItem(item: unknown): item is SessionReferenceDragItem {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Partial<SessionReferenceDragItem>
  return (
    typeof candidate.sessionId === 'string'
    && candidate.sessionId.trim().length > 0
    && typeof candidate.title === 'string'
    && candidate.title.trim().length > 0
  )
}
