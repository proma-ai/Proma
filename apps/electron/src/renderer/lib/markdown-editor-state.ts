export interface MarkdownScrollPosition {
  top: number
  left: number
}

export interface MarkdownEditorSelection {
  from: number
  to: number
}

export interface MarkdownSourceSelection {
  start: number
  end: number
}

export interface MarkdownEditorViewState {
  editing: boolean
  sourceMode: boolean
  draft: string
  lastSavedDraft: string
  previewScroll: MarkdownScrollPosition
  richScroll: MarkdownScrollPosition
  sourceScroll: MarkdownScrollPosition
  richSelection: MarkdownEditorSelection | null
  sourceSelection: MarkdownSourceSelection | null
}

export interface MarkdownEditorScope {
  filePath: string
  dirPath?: string
  gitRoot?: string
  basePaths?: readonly string[]
}

export interface MarkdownEditorOwner {
  sessionId: string
  cacheKey: string
  generation: number
  sessionEpoch: number
}

const EMPTY_SCROLL: MarkdownScrollPosition = { top: 0, left: 0 }
const EDITOR_STATE_CACHE_MAX = 100
const editorStateCache = new Map<string, MarkdownEditorViewState>()
const editorSaveQueue = new Map<string, Promise<void>>()
const editorSessionEpochs = new Map<string, number>()

export function getMarkdownEditorStateSessionEpoch(sessionId: string): number {
  return editorSessionEpochs.get(sessionId) ?? 0
}

function isWindowsPath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\')
}

function normalizePathIdentity(filePath: string, caseInsensitive = isWindowsPath(filePath)): string {
  const input = filePath.trim().replace(/\\/g, '/')
  const drive = input.match(/^([A-Za-z]):(?=\/|$)/)
  const driveLetter = drive?.[1] ?? ''
  const prefix = drive ? `${driveLetter.toLowerCase()}:` : input.startsWith('//') ? '//' : input.startsWith('/') ? '/' : ''
  const body = drive ? input.slice(2) : prefix === '//' ? input.slice(2) : prefix === '/' ? input.slice(1) : input
  const segments: string[] = []
  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop()
      else if (!prefix) segments.push(segment)
      continue
    }
    segments.push(segment)
  }
  let normalized = `${prefix}${segments.join('/')}`
  if (!normalized && prefix) normalized = prefix
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.replace(/\/+$/, '')
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

function isAbsoluteIdentityPath(filePath: string): boolean {
  return filePath.startsWith('/') || filePath.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(filePath)
}

/**
 * 生成渲染层编辑状态的物理文件 identity。
 * 相对路径先按当前解析范围折叠成绝对样式 key，避免同一文件在 Windows 的
 * 斜杠、大小写、相对/绝对表示变化时分裂成多份 draft/selection 状态。
 */
export function createMarkdownEditorCacheKey(scope: MarkdownEditorScope): string {
  const roots = [
    ...(scope.basePaths ?? []),
    scope.gitRoot,
    scope.dirPath,
  ].filter((path): path is string => Boolean(path && path.trim()))
  const root = roots[0]
  const windowsRoot = root ? isWindowsPath(root) : false
  const filePath = isAbsoluteIdentityPath(scope.filePath)
    ? normalizePathIdentity(scope.filePath)
    : root
      ? normalizePathIdentity(`${root.replace(/[\\/]+$/, '')}/${scope.filePath}`, windowsRoot)
      : normalizePathIdentity(scope.filePath)
  return filePath
}

export function isMarkdownEditorOwnerCurrent(
  owner: MarkdownEditorOwner,
  current: MarkdownEditorOwner,
): boolean {
  return owner.sessionId === current.sessionId
    && owner.cacheKey === current.cacheKey
    && owner.generation === current.generation
    && owner.sessionEpoch === current.sessionEpoch
    && getMarkdownEditorStateSessionEpoch(owner.sessionId) === owner.sessionEpoch
}

export function canPersistMarkdownEditorState(isEditableText: boolean | undefined, readOnly: boolean): boolean {
  return Boolean(isEditableText) && !readOnly
}

function getCacheKey(sessionId: string, filePath: string): string {
  return `${sessionId}\u001f${filePath}`
}

function cloneScroll(position: MarkdownScrollPosition): MarkdownScrollPosition {
  return { top: position.top, left: position.left }
}

function cloneState(state: MarkdownEditorViewState): MarkdownEditorViewState {
  return {
    ...state,
    previewScroll: cloneScroll(state.previewScroll),
    richScroll: cloneScroll(state.richScroll),
    sourceScroll: cloneScroll(state.sourceScroll),
    richSelection: state.richSelection ? { ...state.richSelection } : null,
    sourceSelection: state.sourceSelection ? { ...state.sourceSelection } : null,
  }
}

export function createMarkdownEditorViewState(
  draft = '',
  editing = false,
): MarkdownEditorViewState {
  return {
    editing,
    sourceMode: false,
    draft,
    lastSavedDraft: draft,
    previewScroll: cloneScroll(EMPTY_SCROLL),
    richScroll: cloneScroll(EMPTY_SCROLL),
    sourceScroll: cloneScroll(EMPTY_SCROLL),
    richSelection: null,
    sourceSelection: null,
  }
}

export function getMarkdownEditorViewState(
  sessionId: string,
  filePath: string,
): MarkdownEditorViewState | undefined {
  const key = getCacheKey(sessionId, filePath)
  const state = editorStateCache.get(key)
  if (!state) return undefined
  // 以最近访问顺序维护运行期缓存，避免长期打开大量文件时无限增长。
  editorStateCache.delete(key)
  editorStateCache.set(key, state)
  return cloneState(state)
}

export function setMarkdownEditorViewState(
  sessionId: string,
  filePath: string,
  state: MarkdownEditorViewState,
): void {
  const key = getCacheKey(sessionId, filePath)
  if (editorStateCache.has(key)) editorStateCache.delete(key)
  editorStateCache.set(key, cloneState(state))
  while (editorStateCache.size > EDITOR_STATE_CACHE_MAX) {
    const oldestKey = editorStateCache.keys().next().value
    if (oldestKey === undefined) break
    editorStateCache.delete(oldestKey)
  }
}

export function clearMarkdownEditorStateForSession(sessionId: string): void {
  editorSessionEpochs.set(sessionId, getMarkdownEditorStateSessionEpoch(sessionId) + 1)
  const prefix = `${sessionId}\u001f`
  for (const key of editorStateCache.keys()) {
    if (key.startsWith(prefix)) editorStateCache.delete(key)
  }
}

export function clearMarkdownEditorStateCache(): void {
  for (const sessionId of editorSessionEpochs.keys()) {
    editorSessionEpochs.set(sessionId, getMarkdownEditorStateSessionEpoch(sessionId) + 1)
  }
  editorStateCache.clear()
  editorSaveQueue.clear()
  editorSessionEpochs.clear()
}

export function enqueueMarkdownEditorSave<T>(
  sessionId: string,
  filePath: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = getCacheKey(sessionId, filePath)
  const previous = editorSaveQueue.get(key) ?? Promise.resolve()
  const result = previous.then(task, task)
  const settled = result.then(() => undefined, () => undefined)
  editorSaveQueue.set(key, settled)
  void settled.then(() => {
    if (editorSaveQueue.get(key) === settled) editorSaveQueue.delete(key)
  })
  return result
}
