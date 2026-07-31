/**
 * file-panel-drag — 右侧文件面板（会话文件 / 项目文件）拖拽到 Agent 输入框的协议
 *
 * 面板中的文件行通过 draggable + dragstart 写入自定义 MIME 载荷，
 * Agent 输入框 drop 时识别该载荷并把文件作为引用（添加到聊天）加入待发送附件。
 *
 * 载荷结构：
 *   application/x-proma-file-panel → JSON string of FilePanelDragItem[]
 */

export const FILE_PANEL_DRAG_MIME = 'application/x-proma-file-panel'

/**
 * 三点菜单「引用到 Agent」触发的事件名。
 * detail 携带 FilePanelDragItem[]；AgentView 监听后调用 RichTextInput.insertFileMentions。
 */
export const INSERT_FILE_MENTION_EVENT = 'proma:insert-file-mention'

export interface FilePanelDragItem {
  /** 文件绝对路径 */
  path: string
  /** 显示名 */
  name: string
  /** 是否目录（目录拖入时作为附加目录处理） */
  isDirectory: boolean
  /** 来源范围：项目文件 / 会话文件 */
  scope: 'project' | 'session'
}

export function dispatchInsertFileMention(items: FilePanelDragItem[]): void {
  window.dispatchEvent(new CustomEvent(INSERT_FILE_MENTION_EVENT, { detail: items }))
}

export function setFilePanelDragData(dataTransfer: DataTransfer, items: FilePanelDragItem[]): void {
  dataTransfer.setData(FILE_PANEL_DRAG_MIME, JSON.stringify(items))
  // 兜底：同时写入 text/plain，避免部分宿主环境要求必须有文本载荷
  dataTransfer.setData('text/plain', items.map((i) => i.path).join('\n'))
  dataTransfer.effectAllowed = 'copy'
}

export function getFilePanelDragData(dataTransfer: DataTransfer): FilePanelDragItem[] | null {
  const raw = dataTransfer.getData(FILE_PANEL_DRAG_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const items = parsed.filter(isFilePanelDragItem)
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

/** 从文件名推断媒体类型（与 SidePanel 保持一致） */
export function getMediaTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
  if (!imageExts.has(ext)) return 'application/octet-stream'
  const mimeExt = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
  return `image/${mimeExt}`
}

function isFilePanelDragItem(item: unknown): item is FilePanelDragItem {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Partial<FilePanelDragItem>
  return (
    typeof candidate.path === 'string' && candidate.path.length > 0
    && typeof candidate.name === 'string' && candidate.name.length > 0
    && typeof candidate.isDirectory === 'boolean'
    && (candidate.scope === 'project' || candidate.scope === 'session')
  )
}
