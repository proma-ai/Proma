/**
 * DiffTabContent — 单文件 Diff 或纯文件预览内容
 *
 * previewOnly=true 时：代码高亮预览（@pierre/diffs File）或 Markdown 渲染
 * previewOnly=false（默认）：显示 git diff（旧版本 vs 磁盘）
 */

import * as React from 'react'
import { Code2, Copy, Check, Eye, List, Pencil, RefreshCw, Save, X } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import DOMPurify from 'dompurify'
import { File as PierreFile } from '@pierre/diffs/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { agentDiffViewModeAtom, agentDiffRefreshVersionAtom } from '@/atoms/agent-atoms'
import { resolvedThemeAtom } from '@/atoms/theme'
import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
import { markdownTocOpenAtom } from '@/atoms/markdown-toc'
import { useShortcut } from '@/hooks/useShortcut'
import { initShortcutRegistry } from '@/lib/shortcut-registry'
import { DiffView } from './DiffView'
import { MarkdownRichEditor } from './MarkdownRichEditor'
import { PreviewFindBar } from './PreviewFindBar'
import { MarkdownToc } from './MarkdownToc'
import { PIERRE_FILE_CSS } from '@/components/agent/tool-result-renderers/pierre-styles'

const MD_EXTS = new Set(['.md', '.markdown'])
const PLAIN_TEXT_EDIT_EXTS = new Set(['.txt', '.text', '.log'])
const PDF_EXTS = new Set(['.pdf'])
const DOCX_EXTS = new Set(['.docx'])
const OFFICE_PREVIEW_EXTS = new Set(['.xlsx', '.pptx'])
const LEGACY_OFFICE_EXTS = new Set(['.doc', '.xls', '.ppt'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])
const FILE_FIND_SHORTCUT_OPTIONS = { exclusive: true }

/**
 * 简易 LRU 缓存：保留最近访问的 N 个 entries。
 * key 设计：
 * - diff 模式：`${sessionId}:diff:${filePath}@v${refreshVersion}:${scope}`
 * - preview 模式：`${sessionId}:preview:${filePath}@v${refreshVersion}:${scope}`
 * refreshVersion 变化时（agent 写文件、git 突变）key 自然变化，
 * 老 entry 不会被命中，最终被 LRU 淘汰；无需主动失效。
 */
type CacheEntry = {
  oldContent: string
  newContent: string
  /** 非文本文件预览数据 */
  pdfSrc?: string
  imageDataUrl?: string
  imagePath?: string
  docxHtml?: string
  officeHtml?: string
  officeText?: string
}
const CACHE_MAX = 50
const contentCache = new Map<string, CacheEntry>()

/** 超过此字符数的文本文件将跳过 PierreFile 高亮，直接以纯文本展示，避免大文件卡顿 */
const MAX_PREVIEW_CHARS = 500_000

/** 选中文本最大字符数（与 Bozeman DOM 模式一致） */
const MAX_QUOTED_CHARS = 2000

/** 滚动位置持久化：key = `${sessionId}:${filePath}` */
const scrollPositionCache = new Map<string, { top: number; left: number }>()

function scrollCacheKey(sessionId: string, filePath: string): string {
  return `${sessionId}:${filePath}`
}

/** 获取缓存的滚动位置 */
export function getPreviewScrollPosition(sessionId: string, filePath: string): { top: number; left: number } | undefined {
  return scrollPositionCache.get(scrollCacheKey(sessionId, filePath))
}

/**
 * 清除指定 session 的预览缓存，供 useCloseTab 调用。
 */
export function clearPreviewCacheForSession(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of scrollPositionCache.keys()) {
    if (key.startsWith(prefix)) scrollPositionCache.delete(key)
  }
  for (const key of contentCache.keys()) {
    if (key.startsWith(prefix)) contentCache.delete(key)
  }
}
function cacheGet(key: string): CacheEntry | undefined {
  const v = contentCache.get(key)
  if (!v) return undefined
  // 重新插入到末尾，更新 LRU 位置
  contentCache.delete(key)
  contentCache.set(key, v)
  return v
}
function cacheSet(key: string, value: CacheEntry): void {
  if (contentCache.has(key)) contentCache.delete(key)
  contentCache.set(key, value)
  if (contentCache.size > CACHE_MAX) {
    const oldestKey = contentCache.keys().next().value
    if (oldestKey !== undefined) contentCache.delete(oldestKey)
  }
}

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

/** 判断选区是否在容器内（穿透 Shadow DOM 边界） */
function isSelectionInside(container: HTMLElement, selection: Selection): boolean {
  if (selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  let node: Node | null = range.commonAncestorContainer
  while (node) {
    if (node === container) return true
    const root = node.getRootNode()
    if (root instanceof ShadowRoot) {
      // Shadow DOM 边界：从 shadowRoot.host 继续向上
      node = root.host
    } else {
      // 普通 DOM：沿 parentNode 向上
      node = node.parentNode
    }
  }
  return false
}

/** 获取容器内的选区：先查光 DOM，再遍历缓存的 ShadowRoot 集合 */
function getDeepSelection(container: HTMLElement, shadowRoots?: Set<ShadowRoot> | null): { text: string } | null {
  const docSel = document.getSelection()
  if (docSel && !docSel.isCollapsed && docSel.rangeCount > 0) {
    if (isSelectionInside(container, docSel)) {
      const text = docSel.toString().trim()
      if (text) return { text }
    }
  }

  if (shadowRoots) {
    // 直接遍历缓存的 ShadowRoot（O(n) 其中 n = ShadowRoot 数量，通常 2-3 个）
    for (const sr of shadowRoots) {
      // 检查 host 是否仍在 DOM 中（可能已被移除）
      if (!container.contains(sr.host)) continue
      const shadowSel = (sr as { getSelection?: () => Selection | null }).getSelection?.()
      if (shadowSel && !shadowSel.isCollapsed && shadowSel.rangeCount > 0) {
        const text = shadowSel.toString().trim()
        if (text) return { text }
      }
    }
    return null
  }

  // 兜底：无缓存时递归遍历（组件初始化瞬间可能命中一次）
  function walk(node: Node): { text: string } | null {
    if (node instanceof HTMLElement && node.shadowRoot) {
      const shadowSel = (node.shadowRoot as { getSelection?: () => Selection | null }).getSelection?.()
      if (shadowSel && !shadowSel.isCollapsed && shadowSel.rangeCount > 0) {
        const text = shadowSel.toString().trim()
        if (text) return { text }
      }
      const result = walk(node.shadowRoot)
      if (result) return result
    }
    for (const child of node.childNodes) {
      const result = walk(child)
      if (result) return result
    }
    return null
  }
  return walk(container)
}

/** 用 TreeWalker 发现容器内所有现有 ShadowRoot（仅初始化时调用一次） */
function discoverShadowRoots(root: Node, target: Set<ShadowRoot>): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement
    if (el.shadowRoot) target.add(el.shadowRoot)
  }
}

interface DiffTabContentProps {
  filePath: string
  dirPath: string
  sessionId: string
  gitRoot?: string
  previewOnly?: boolean
  /** 禁用预览内编辑，适用于 clipboard 等临时快照 */
  readOnly?: boolean
  /** 候选基础目录（previewOnly 模式下用于路径解析） */
  basePaths?: string[]
  /** diff 模式下检测到内容为空（无差异）时回调，用于自动关闭预览面板 */
  onEmptyDiff?: () => void
  /** 由外层场景注入的额外工具按钮，例如默认应用打开、返回会话 */
  toolbarActions?: React.ReactNode
  /** 基准 ref（如 "origin/main"），用于 worktree vs main 模式 */
  baseRef?: string
}

export function DiffTabContent({ filePath, dirPath, sessionId, gitRoot, previewOnly, readOnly, basePaths, onEmptyDiff, toolbarActions, baseRef }: DiffTabContentProps): React.ReactElement {
  const [viewMode, setViewMode] = useAtom(agentDiffViewModeAtom)
  const [oldContent, setOldContent] = React.useState('')
  const [newContent, setNewContent] = React.useState('')
  const [markdownEditing, setMarkdownEditing] = React.useState(false)
  const [markdownSourceMode, setMarkdownSourceMode] = React.useState(false)
  const [markdownDraft, setMarkdownDraft] = React.useState('')
  const [markdownSaving, setMarkdownSaving] = React.useState(false)
  const [autosaveStatus, setAutosaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedDraftRef = React.useRef('')
  const autosaveTimerRef = React.useRef<number | null>(null)
  const [docxHtml, setDocxHtml] = React.useState('')
  const [officeHtml, setOfficeHtml] = React.useState('')
  const [officeText, setOfficeText] = React.useState('')
  const [pdfSrc, setPdfSrc] = React.useState('')
  const [pdfZoom, setPdfZoom] = React.useState(100)
  const pdfIframeRef = React.useRef<HTMLIFrameElement>(null)
  const [imagePath, setImagePath] = React.useState('')
  const [imageDataUrl, setImageDataUrl] = React.useState('')
  // 默认 25%：预览面板空间有限，先展示缩略全貌，用户可手动放大查看细节
  const [imageZoom, setImageZoom] = React.useState(0.25)
  const [imageNaturalSize, setImageNaturalSize] = React.useState({ w: 0, h: 0 })
  const imageContainerRef = React.useRef<HTMLDivElement>(null)
  const imageDragging = React.useRef(false)
  const imageDragStart = React.useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const [findOpen, setFindOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [copied, setCopied] = React.useState(false)
  const refreshVersionMap = useAtomValue(agentDiffRefreshVersionAtom)
  const setRefreshVersionMap = useSetAtom(agentDiffRefreshVersionAtom)
  const refreshVersion = refreshVersionMap.get(sessionId) ?? 0
  const previewContentVersion = previewOnly ? refreshVersion : 0
  const theme = useAtomValue(resolvedThemeAtom)
  const [tocOpen, setTocOpen] = useAtom(markdownTocOpenAtom)

  const ext = getExtension(filePath)
  const isMarkdown = previewOnly && MD_EXTS.has(ext)
  const isPlainTextEditable = previewOnly && PLAIN_TEXT_EDIT_EXTS.has(ext)
  const isEditableText = isMarkdown || isPlainTextEditable
  const isPdf = previewOnly && PDF_EXTS.has(ext)
  const isDocx = previewOnly && DOCX_EXTS.has(ext)
  const isOfficePreview = previewOnly && OFFICE_PREVIEW_EXTS.has(ext)
  const isLegacyOffice = previewOnly && LEGACY_OFFICE_EXTS.has(ext)
  const isImage = previewOnly && IMAGE_EXTS.has(ext)

  React.useEffect(() => {
    initShortcutRegistry()
  }, [])

  useShortcut(
    'file-find',
    React.useCallback(() => setFindOpen(true), []),
    true,
    FILE_FIND_SHORTCUT_OPTIONS,
  )

  const findContentKey = React.useMemo(() => JSON.stringify({
    filePath,
    previewOnly: Boolean(previewOnly),
    viewMode,
    loading,
    newLength: newContent.length,
    oldLength: oldContent.length,
    docxLength: docxHtml.length,
    officeLength: officeHtml.length,
    markdownEditing,
    markdownSourceMode,
  }), [docxHtml.length, filePath, loading, markdownEditing, markdownSourceMode, newContent.length, officeHtml.length, oldContent.length, previewOnly, viewMode])

  // 目录提取只需在「文件本身或其内容」变化时重建，避免 loading/编辑态切换造成的抖动
  const tocContentKey = React.useMemo(
    () => JSON.stringify({ filePath, previewContentVersion, newLength: newContent.length }),
    [filePath, previewContentVersion, newContent.length],
  )

  // ===== 选中文本引用（Quoted Selection）=====

  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const filePathRef = React.useRef(filePath)
  filePathRef.current = filePath
  const shadowRootsRef = React.useRef<Set<ShadowRoot>>(new Set())
  /** 当前正在展示的截断 toast id；选中回落到上限内或选区消失时主动 dismiss */
  const lastToastIdRef = React.useRef<string | null>(null)

  const dismissTruncationToast = React.useCallback(() => {
    if (lastToastIdRef.current) {
      toast.dismiss(lastToastIdRef.current)
      lastToastIdRef.current = null
    }
  }, [])

  /** 捕获预览面板中的文本选中，写入 quotedSelectionMapAtom */
  const handleSelectionCapture = React.useCallback(() => {
    if (!previewOnly) return
    const container = scrollContainerRef.current
    if (!container) return

    const deepSel = getDeepSelection(container, shadowRootsRef.current)
    if (!deepSel) {
      // 选区消失：先撤掉截断 toast，再判断是否清 Chip
      dismissTruncationToast()
      // 若焦点在 ProseMirror 编辑器（输入框），保留 Chip；否则清除
      const activeEl = document.activeElement
      if (activeEl && (activeEl.closest?.('.ProseMirror') || activeEl.closest?.('[data-input-mode]'))) return
      setQuotedSelectionMap((prev) => {
        const m = new Map(prev)
        if (!m.has(sessionId)) return prev
        m.delete(sessionId)
        return m
      })
      return
    }

    // 实时更新只存文本 + 路径，不计算行号
    const truncated = deepSel.text.length > MAX_QUOTED_CHARS
    const newText = truncated ? deepSel.text.slice(0, MAX_QUOTED_CHARS) : deepSel.text
    const newFilePath = filePathRef.current
    setQuotedSelectionMap((prev) => {
      const existing = prev.get(sessionId)
      // 选区文本与路径都未变 → 跳过 atom 写入，避免触发 AgentView 整树重渲染
      if (existing && existing.text === newText && existing.filePath === newFilePath) {
        return prev
      }
      const m = new Map(prev)
      m.set(sessionId, {
        text: newText,
        filePath: newFilePath,
        capturedAt: Date.now(),
      })
      return m
    })
    // 超过上限时按千位分档 toast；跨档时撤掉上一档，回到上限内则全部撤掉
    if (truncated) {
      const k = Math.floor(deepSel.text.length / 1000) * 1000
      const id = `quoted-chars-cap:${sessionId}:${k}`
      if (lastToastIdRef.current && lastToastIdRef.current !== id) {
        toast.dismiss(lastToastIdRef.current)
      }
      toast.warning(`已选中 >${k} 字符，仅能发送前 ${MAX_QUOTED_CHARS} 字符`, {
        id,
        duration: 3000,
      })
      lastToastIdRef.current = id
    } else {
      dismissTruncationToast()
    }
  }, [previewOnly, sessionId, setQuotedSelectionMap, dismissTruncationToast])

  // 监听选区变化：document selectionchange + 容器内鼠标拖拽轮询
  React.useEffect(() => {
    if (!previewOnly) return
    const container = scrollContainerRef.current
    if (!container) return

    // 初始化 ShadowRoot 缓存：TreeWalker 一次扫描 + MutationObserver 增量更新
    const shadowRoots = shadowRootsRef.current
    shadowRoots.clear()
    discoverShadowRoots(container, shadowRoots)
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement && node.shadowRoot) shadowRoots.add(node.shadowRoot)
          // 递归发现新增子树中的 shadowRoot
          discoverShadowRoots(node, shadowRoots)
        }
        for (const node of m.removedNodes) {
          if (node instanceof HTMLElement) {
            if (node.shadowRoot) shadowRoots.delete(node.shadowRoot)
            // 清理被移除子树中的所有 ShadowRoot 引用，避免 Set 持有已分离节点
            const stale = new Set<ShadowRoot>()
            discoverShadowRoots(node, stale)
            for (const sr of stale) shadowRoots.delete(sr)
          }
        }
      }
    })
    mo.observe(container, { childList: true, subtree: true })

    let tracking = false
    let rafId = 0

    const scheduleCapture = () => {
      // 快速路径：非拖拽时若 document 选区已折叠（输入框打字/点击），跳过昂贵的树遍历。
      // @pierre/diffs 使用 open Shadow DOM，Chrome/Electron 会将 shadow 内选区反映到
      // document.getSelection()，因此键盘选区（Shift+Arrow）也能通过此检查。
      if (!tracking) {
        const docSel = document.getSelection()
        if (!docSel || docSel.isCollapsed) return
        // 光 DOM 快速检查：选区不在预览容器内也跳过
        if (!isSelectionInside(container, docSel)) return
      }
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        handleSelectionCapture()
      })
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) tracking = true
    }
    const onMouseMove = () => {
      if (tracking) scheduleCapture()
    }
    const onMouseUp = () => {
      if (tracking) {
        tracking = false
        scheduleCapture()
      }
    }
    const onSelectionChange = () => {
      scheduleCapture()
    }

    container.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      mo.disconnect()
      shadowRoots.clear()
      container.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      // unmount / 切预览 / 切 session 时撤掉残留的截断 toast，避免贴脸 3 秒
      dismissTruncationToast()
    }
  }, [previewOnly, handleSelectionCapture, dismissTruncationToast])

  const fileAccess = React.useMemo(() => ({
    sessionId,
    candidateBasePaths: basePaths,
  }), [sessionId, basePaths])

  const contentCacheScope = React.useMemo(() => JSON.stringify({
    dirPath,
    gitRoot: gitRoot ?? '',
    basePaths: basePaths ?? [],
  }), [basePaths, dirPath, gitRoot])

  const getContentCacheKey = React.useCallback((mode: 'preview' | 'diff', version: number) => (
    `${sessionId}:${mode}:${filePath}@v${version}:${contentCacheScope}`
  ), [contentCacheScope, filePath, sessionId])

  // PierreFile props 缓存，避免每次渲染创建新对象导致内部重新高亮
  const pierreFile = React.useMemo(() => ({
    name: filePath.split('/').pop() ?? filePath,
    contents: newContent,
    cacheKey: `${filePath}:${newContent.length}:${previewContentVersion}`,
  }), [filePath, newContent, previewContentVersion])

  const pierreOptions = React.useMemo(() => ({
    theme: { dark: 'one-dark-pro' as const, light: 'one-light' as const },
    disableFileHeader: true,
    overflow: 'scroll' as const,
    themeType: theme as 'light' | 'dark' | 'system',
    unsafeCSS: PIERRE_FILE_CSS,
  }), [theme])
  const markdownFileAccess = React.useMemo(() => {
    const candidateBasePaths: string[] = []
    const slash = filePath.lastIndexOf('/')
    if (slash > 0) candidateBasePaths.push(filePath.slice(0, slash))
    if (dirPath) candidateBasePaths.push(dirPath)
    for (const basePath of basePaths ?? []) {
      if (basePath && !candidateBasePaths.includes(basePath)) candidateBasePaths.push(basePath)
    }
    return { sessionId, candidateBasePaths }
  }, [basePaths, dirPath, filePath, sessionId])

  // props 变化时立即清空内容状态，避免在 useEffect 执行前渲染旧数据
  React.useEffect(() => {
    setOldContent('')
    setNewContent('')
    setDocxHtml('')
    setOfficeHtml('')
    setOfficeText('')
    setPdfSrc('')
    setPdfZoom(100)
    setImagePath('')
    setImageDataUrl('')
    setImageZoom(0.25)
    setImageNaturalSize({ w: 0, h: 0 })
    setLoading(!isLegacyOffice)
    setMarkdownEditing(false)
    setMarkdownSourceMode(false)
    setMarkdownDraft('')
    setMarkdownSaving(false)
  }, [filePath, sessionId, previewOnly, isLegacyOffice])

  // non-passive wheel listener for pinch-to-zoom on image
  React.useEffect(() => {
    const el = imageContainerRef.current
    if (!el || !isImage) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setImageZoom((z) => Math.max(0.1, Math.min(5, z * (e.deltaY < 0 ? 1.04 : 1 / 1.04))))
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [isImage, imageDataUrl])

  // 监听 PDF iframe 发回的缩放百分比
  React.useEffect(() => {
    if (!isPdf) return
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'pdf-zoom-changed') setPdfZoom(e.data.zoom)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isPdf])

  // 上次加载的内容（refreshVersion 触发时用来对比是否变化）
  const lastNewContentRef = React.useRef('')
  const lastOldContentRef = React.useRef('')

  // 滚动位置持久化 key（sessionId:filePath）。主加载 effect 在缓存未命中时
  // 也会读它判断是否需要恢复滚动，故声明须早于该 effect。
  const scrollKey = scrollCacheKey(sessionId, filePath)

  // 主加载 effect：上下文变化（filePath/dirPath/gitRoot/previewOnly）时触发；
  // 纯预览模式也跟随 refreshVersion 失效，保证同一文件二次写入后重新读盘。
  // 命中缓存时跳过 loading 闪烁直接渲染；未命中走 IPC 拉取
  React.useEffect(() => {
    let cancelled = false

    // 所有文件类型均可缓存（含 PDF/DOCX/Office/Image）
    const cacheKey = previewOnly
      ? getContentCacheKey('preview', previewContentVersion)
      : getContentCacheKey('diff', refreshVersion)
    const cached = cacheGet(cacheKey)

    if (cached) {
      // 命中：直接同步渲染，不闪
      restoreScrollRef.current = true
      lastNewContentRef.current = cached.newContent
      lastOldContentRef.current = cached.oldContent
      setOldContent(cached.oldContent)
      setNewContent(cached.newContent)
      setDocxHtml(cached.docxHtml ?? '')
      setOfficeHtml(cached.officeHtml ?? '')
      setOfficeText(cached.officeText ?? '')
      setPdfSrc(cached.pdfSrc ?? '')
      setPdfZoom(100)
      setImagePath(cached.imagePath ?? '')
      setImageDataUrl(cached.imageDataUrl ?? '')
      setImageZoom(0.25)
      setImageNaturalSize({ w: 0, h: 0 })
      setLoading(false)
      return // 缓存命中，直接返回，不执行 load()
    } else {
      if (!isLegacyOffice) setLoading(true)
      setOldContent('')
      setNewContent('')
      setDocxHtml('')
      setOfficeHtml('')
      setOfficeText('')
      setPdfSrc('')
      setPdfZoom(100)
      setImagePath('')
      setImageDataUrl('')
      setImageZoom(0.25)
      setImageNaturalSize({ w: 0, h: 0 })
      lastNewContentRef.current = ''
      lastOldContentRef.current = ''
      // 内容缓存被 LRU 淘汰但滚动位置仍在时（如切走会话后预览 Tab 重建），
      // 也标记需要恢复，待 load() 重新拉取渲染后回到上次滚动位置。
      if (scrollPositionCache.has(scrollKey)) {
        restoreScrollRef.current = true
      }
    }

    async function load() {
      try {
        let content = cached?.newContent ?? ''
        let old = cached?.oldContent ?? ''

        if (!cached) {
          if (previewOnly) {
            if (isPdf) {
              const result = await window.electronAPI.preparePdfPreview(filePath, fileAccess)
              if (cancelled) return
              const src = result?.tmpHtmlUrl ?? ''
              setPdfSrc(src)
              cacheSet(cacheKey, { oldContent: '', newContent: '', pdfSrc: src })
              return
            }
            if (isImage) {
              const resolved = await window.electronAPI.resolveFilePath(filePath, fileAccess)
              if (cancelled) return
              if (resolved) {
                setImagePath(filePath)
                setImageDataUrl(resolved.url)
                cacheSet(cacheKey, { oldContent: '', newContent: '', imagePath: filePath, imageDataUrl: resolved.url })
              } else {
                setImagePath('')
                setImageDataUrl('')
                cacheSet(cacheKey, { oldContent: '', newContent: '', imagePath: '', imageDataUrl: '' })
              }
              return
            }
            if (isDocx) {
              const result = await window.electronAPI.docxToHtml(filePath, fileAccess)
              if (cancelled) return
              const html = DOMPurify.sanitize(result?.html ?? '')
              setDocxHtml(html)
              cacheSet(cacheKey, { oldContent: '', newContent: '', docxHtml: html })
              return
            }
            if (isOfficePreview) {
              const result = await window.electronAPI.officeToHtml(filePath, fileAccess)
              if (cancelled) return
              const html = DOMPurify.sanitize(result?.html ?? '')
              const text = result?.text ?? ''
              setOfficeHtml(html)
              setOfficeText(text)
              cacheSet(cacheKey, { oldContent: '', newContent: '', officeHtml: html, officeText: text })
              return
            }
            if (isLegacyOffice) {
              return
            }
            const result = await window.electronAPI.resolveAndReadFile(filePath, fileAccess)
            if (cancelled) return
            content = result?.content ?? ''
          } else {
            const result = await window.electronAPI.getDiffContents({ dirPath, filePath, gitRoot, sessionId, baseRef })
            if (cancelled) return
            content = result?.newContent ?? ''
            old = result?.oldContent ?? ''
          }

          lastNewContentRef.current = content
          lastOldContentRef.current = old
          setOldContent(old)
          setNewContent(content)

          if (cacheKey) cacheSet(cacheKey, { oldContent: old, newContent: content })
        }

        if (previewOnly && !MD_EXTS.has(ext) && content) {
          if (!cancelled) setLoading(false)
        }
      } catch {
        // 加载失败静默处理
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, dirPath, gitRoot, previewOnly, previewContentVersion, fileAccess, isPdf, isDocx, isOfficePreview, isLegacyOffice, isImage, sessionId, ext, getContentCacheKey])

  // refreshVersion 触发的静默刷新：仅 diff 模式、内容有变化时才更新 state
  const prevRefreshRef = React.useRef(-1)
  React.useEffect(() => {
    if (previewOnly) return
    // 首次跳过（避免首屏加载时和主 effect 重复拉取）
    if (prevRefreshRef.current === -1) {
      prevRefreshRef.current = refreshVersion
      return
    }
    if (prevRefreshRef.current === refreshVersion) return
    prevRefreshRef.current = refreshVersion

    let cancelled = false
    async function refresh() {
      try {
        const result = await window.electronAPI.getDiffContents({ dirPath, filePath, gitRoot, sessionId })
        if (cancelled || !result) return
        const newC = result.newContent ?? ''
        const oldC = result.oldContent ?? ''
        // 用新 refreshVersion 写入缓存，让后续切走再切回来能命中
        cacheSet(getContentCacheKey('diff', refreshVersion), { oldContent: oldC, newContent: newC })
        if (newC === lastNewContentRef.current && oldC === lastOldContentRef.current) return
        lastNewContentRef.current = newC
        lastOldContentRef.current = oldC
        setNewContent(newC)
        setOldContent(oldC)
      } catch {
        // ignore
      }
    }
    refresh()
    return () => { cancelled = true }
  }, [refreshVersion, previewOnly, filePath, dirPath, gitRoot, sessionId, getContentCacheKey])

  // diff 模式：内容加载完成后若新旧一致（无差异），通知父组件关闭预览面板
  const emptyDiffFiredRef = React.useRef(false)
  React.useEffect(() => {
    emptyDiffFiredRef.current = false
  }, [filePath, sessionId])
  React.useEffect(() => {
    if (previewOnly || loading || emptyDiffFiredRef.current) return
    if (oldContent === newContent) {
      emptyDiffFiredRef.current = true
      onEmptyDiff?.()
    }
  }, [previewOnly, loading, oldContent, newContent, onEmptyDiff])

  // previewOnly 模式：加载完成后若内容无法预览，弹 Toast 通知用户
  const toastedPreviewFailRef = React.useRef('')
  React.useEffect(() => {
    if (!previewOnly || loading) return
    const key = `${filePath}:${ext}`
    if (toastedPreviewFailRef.current === key) return
    let message: string | null = null
    if (isLegacyOffice) {
      message = `暂不支持 ${ext.toUpperCase().slice(1)} 格式内联预览`
    } else if (isPdf && !pdfSrc) {
      message = 'PDF 文件过大，无法在此预览'
    } else if (isDocx && !docxHtml) {
      message = '无法加载 DOCX 预览'
    } else if (isOfficePreview && !officeHtml) {
      message = `无法加载 ${ext === '.pptx' ? 'PPTX' : 'Excel'} 预览`
    } else if (isImage && !imageDataUrl) {
      message = '图片文件过大，无法在此预览'
    }
    if (message) {
      toastedPreviewFailRef.current = key
      toast.warning(message)
    }
  }, [previewOnly, loading, filePath, ext, isLegacyOffice, isPdf, pdfSrc, isDocx, docxHtml, isOfficePreview, officeHtml, isImage, imageDataUrl])

  // scrollPosition persistent: module-level Map keyed by sessionId:filePath
  // content changes (refreshVersion bump) → delete stored position;
  // cached mount → restore; scroll → save.
  const prevRefreshVersionRef = React.useRef(refreshVersion)

  // WHEN content version changes (refreshVersion bump): delete stored scroll position
  // 只在内容变化时清除，切换文件时保留位置以支持返回导航
  React.useEffect(() => {
    if (loading) return // still loading, don't clear yet
    if (prevRefreshVersionRef.current !== refreshVersion) {
      // refreshVersion changed for current file → content updated, clear position
      scrollPositionCache.delete(scrollKey)
      prevRefreshVersionRef.current = refreshVersion
    }
  }, [scrollKey, refreshVersion, loading])

  // RESTORE scroll position after cached content renders
  const restoreScrollRef = React.useRef(false)
  React.useEffect(() => {
    if (loading || !restoreScrollRef.current) return
    restoreScrollRef.current = false
    const pos = scrollPositionCache.get(scrollKey)
    if (pos && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = pos.top
      scrollContainerRef.current.scrollLeft = pos.left
    }
  }, [loading, scrollKey])

  // SAVE scroll position on scroll (throttled via rAF)
  const scrollRafRef = React.useRef(0)
  const handleScroll = React.useCallback(() => {
    if (scrollRafRef.current) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const el = scrollContainerRef.current
      if (el) {
        scrollPositionCache.set(scrollKey, { top: el.scrollTop, left: el.scrollLeft })
      }
    })
  }, [scrollKey])

  // Cleanup rAF on unmount to prevent stale writes
  React.useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  const handleCopy = React.useCallback(async () => {
    try {
      const copyText = markdownEditing ? markdownDraft : (isOfficePreview ? officeText : newContent)
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 复制失败
    }
  }, [isOfficePreview, markdownDraft, markdownEditing, newContent, officeText])

  const startMarkdownEdit = React.useCallback(() => {
    if (!isEditableText) return
    setMarkdownDraft(newContent)
    lastSavedDraftRef.current = newContent
    setAutosaveStatus('idle')
    setMarkdownSourceMode(false)
    setMarkdownEditing(true)
  }, [isEditableText, newContent])

  // ref 形式的 persist：避免 callback / effect 因 refreshVersion 频繁变化而重建
  const persistRef = React.useRef<(draft: string, fp: string, fa: typeof fileAccess) => Promise<boolean>>(async () => false)

  const exitMarkdownEdit = React.useCallback(() => {
    // 退出前 flush 待保存的草稿，避免用户在 debounce 窗口内退出时丢失输入。
    // 不再用 `draft !== ''` 过滤：清空整个文件也是合法编辑，依靠
    // `draft !== lastSavedDraftRef.current` 已能避免初次进入时无意义写盘
    // （startMarkdownEdit 时 lastSavedDraftRef = newContent）。
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    if (markdownDraft !== lastSavedDraftRef.current) {
      void persistRef.current(markdownDraft, filePath, fileAccess)
    }
    setMarkdownSourceMode(false)
    setMarkdownEditing(false)
    setAutosaveStatus('idle')
  }, [markdownDraft, filePath, fileAccess])

  // 写盘核心：不退出编辑模式，被 autosave、saveMarkdownEdit、flush 共用。
  // 接收显式参数（不依赖闭包），保证切换文件后 flush 用旧文件路径。
  // 同一份 draft 重复触发会被 `draft === lastSavedDraftRef.current` 短路，
  // 因此 autosave timer 与 unmount cleanup 偶发的双重 fire 不会真的写两次。
  const persistMarkdownDraft = React.useCallback(async (
    draft: string,
    fp: string,
    fa: typeof fileAccess,
  ): Promise<boolean> => {
    if (draft === lastSavedDraftRef.current) return true
    setAutosaveStatus('saving')
    try {
      const ok = await window.electronAPI.writeTextFile(fp, draft, fa)
      if (!ok) {
        setAutosaveStatus('error')
        return false
      }
      lastSavedDraftRef.current = draft
      // 仅当当前展示的仍是这个文件时，才同步 UI state，避免覆盖刚切到的新文件
      if (fp === filePathRef.current) {
        lastNewContentRef.current = draft
        lastOldContentRef.current = ''
        setOldContent('')
        setNewContent(draft)
        cacheSet(getContentCacheKey('preview', refreshVersion + 1), { oldContent: '', newContent: draft })
        setRefreshVersionMap((prev) => {
          const m = new Map(prev)
          m.set(sessionId, (prev.get(sessionId) ?? 0) + 1)
          return m
        })
        setAutosaveStatus('saved')
      }
      return true
    } catch (err) {
      console.error('[DiffTabContent] Markdown save failed:', err)
      setAutosaveStatus('error')
      return false
    }
  }, [getContentCacheKey, refreshVersion, sessionId, setRefreshVersionMap])

  const saveMarkdownEdit = React.useCallback(async () => {
    if (!isEditableText || markdownSaving) return
    // autosaveTimerRef 由 autosave effect 创建；这里手动清是为了避免
    // "立即保存"返回后 effect cleanup 再次清掉一个已经 null 的句柄（无害但冗余），
    // 同时也确保不会在 await 期间触发延迟回调
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    setMarkdownSaving(true)
    const ok = await persistMarkdownDraft(markdownDraft, filePath, fileAccess)
    setMarkdownSaving(false)
    if (!ok) {
      window.alert('保存失败：没有写入权限或文件不存在')
      return
    }
    setMarkdownSourceMode(false)
    setMarkdownEditing(false)
  }, [fileAccess, filePath, isEditableText, markdownDraft, markdownSaving, persistMarkdownDraft])

  const handleManualRefresh = React.useCallback(() => {
    setRefreshVersionMap((prev) => {
      const m = new Map(prev)
      m.set(sessionId, (prev.get(sessionId) ?? 0) + 1)
      return m
    })
  }, [sessionId, setRefreshVersionMap])

  // persistRef 始终持有最新 persistMarkdownDraft，供 setTimeout / unmount cleanup 调用。
  // 用 effect 而非渲染期赋值，避免 React 19 严格模式下并发渲染中途读到中间态。
  React.useEffect(() => {
    persistRef.current = persistMarkdownDraft
  }, [persistMarkdownDraft])

  // 自动保存：编辑模式下停止输入 1.5s 后写盘。
  // timer 所有权：autosave effect 创建并在 cleanup 中清；saveMarkdownEdit / exitMarkdownEdit
  // 也会主动清以抢占 debounce。多处清理都是幂等的（设 null 后再清是 no-op）。
  React.useEffect(() => {
    if (!markdownEditing || !isEditableText) return
    if (markdownDraft === lastSavedDraftRef.current) return
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
    }
    const draftSnapshot = markdownDraft
    const fpSnapshot = filePath
    const faSnapshot = fileAccess
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null
      void persistRef.current(draftSnapshot, fpSnapshot, faSnapshot)
    }, 1500)
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [markdownDraft, markdownEditing, isEditableText, filePath, fileAccess])

  // saved → 1.5s 后回到 idle，避免指示器一直停在"已保存"
  React.useEffect(() => {
    if (autosaveStatus !== 'saved') return
    const id = window.setTimeout(() => setAutosaveStatus('idle'), 1500)
    return () => window.clearTimeout(id)
  }, [autosaveStatus])

  // 切换文件 / 卸载：若有未保存的 draft，fire-and-forget flush 到旧文件。
  // persistMarkdownDraft 内的 short-circuit 保证即便 autosave timer 刚 fire 过、
  // 这里又 flush 一次，也不会真的写两次盘。
  const flushStateRef = React.useRef({ draft: '', editing: false, filePath, fileAccess })
  flushStateRef.current = { draft: markdownDraft, editing: markdownEditing, filePath, fileAccess }
  React.useEffect(() => {
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
      const { draft, editing, filePath: fp, fileAccess: fa } = flushStateRef.current
      // 不过滤空 draft：startMarkdownEdit 已把 lastSavedDraftRef 设为 newContent，
      // 因此"原本就空、未编辑"的情况会被 dirty 比较自动跳过；而"非空清空"是合法操作必须落盘。
      if (editing && isEditableText && draft !== lastSavedDraftRef.current) {
        void persistRef.current(draft, fp, fa)
      }
    }
    // 仅依赖 filePath/sessionId：切文件时执行 cleanup 触发 flush；
    // draft/editing/fileAccess 通过 ref 读取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, sessionId])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0">
        <span className="text-[12px] text-foreground/60 truncate" title={filePath}>
          {filePath}
        </span>

        {!previewOnly && (
          <div
            className="relative flex rounded-lg bg-muted p-0.5 shrink-0 ml-auto cursor-pointer select-none"
            onClick={() => setViewMode((v) => v === 'split' ? 'unified' : 'split')}
          >
            <div
              className={cn(
                'absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-in-out',
                viewMode === 'unified' ? 'translate-x-full' : 'translate-x-0',
              )}
            />
            <span className={cn('relative z-[1] rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              viewMode === 'split' ? 'text-foreground' : 'text-muted-foreground')}>分栏</span>
            <span className={cn('relative z-[1] rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              viewMode === 'unified' ? 'text-foreground' : 'text-muted-foreground')}>统一</span>
          </div>
        )}

        {previewOnly && isEditableText && !readOnly && (
          markdownEditing ? (
            <div className="ml-auto flex items-center gap-1">
              {isMarkdown && (
                <button
                  type="button"
                  onClick={() => setMarkdownSourceMode((v) => !v)}
                  disabled={markdownSaving}
                  className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 disabled:opacity-50 shrink-0"
                  title={markdownSourceMode ? '切换到富文本编辑' : '切换到源码编辑'}
                >
                  {markdownSourceMode ? <Eye className="size-3.5" /> : <Code2 className="size-3.5" />}
                </button>
              )}
              <button
                type="button"
                onClick={exitMarkdownEdit}
                disabled={markdownSaving}
                className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 disabled:opacity-50 shrink-0"
                title="退出编辑"
              >
                <X className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void saveMarkdownEdit()}
                disabled={markdownSaving}
                className={cn(
                  'p-1 rounded hover:bg-foreground/[0.06] disabled:opacity-50 shrink-0 transition-colors duration-300',
                  autosaveStatus === 'saved' && 'text-green-500 hover:text-green-500',
                  autosaveStatus === 'error' && 'text-red-500 hover:text-red-500',
                  autosaveStatus !== 'saved' && autosaveStatus !== 'error' && 'text-foreground/40 hover:text-foreground/60',
                )}
                title={
                  autosaveStatus === 'error'
                    ? '自动保存失败，点击重试'
                    : autosaveStatus === 'saved'
                      ? '已保存'
                      : '立即保存并退出'
                }
              >
                <Save className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startMarkdownEdit}
              className="ml-auto p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 shrink-0"
              title={isMarkdown ? '编辑 Markdown' : '编辑文本'}
            >
              <Pencil className="size-3.5" />
            </button>
          )
        )}

        <button type="button" onClick={handleCopy}
          className={cn("p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 shrink-0", previewOnly && !isEditableText && "ml-auto")}
          title="复制文件内容">
          {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
        </button>

        <button
          type="button"
          onClick={handleManualRefresh}
          className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 shrink-0"
          title="刷新文件内容（检测外部编辑器的修改）"
        >
          <RefreshCw className="size-3.5" />
        </button>

        {isMarkdown && !markdownEditing && (
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className={cn(
              'p-1 rounded hover:bg-foreground/[0.06] shrink-0',
              tocOpen ? 'text-foreground/70' : 'text-foreground/40 hover:text-foreground/60',
            )}
            title={tocOpen ? '隐藏目录' : '显示目录'}
          >
            <List className="size-3.5" />
          </button>
        )}

        {toolbarActions}
      </div>

      <div className="relative flex-1 min-h-0 flex">
        <PreviewFindBar
          open={findOpen}
          rootRef={scrollContainerRef}
          contentKey={findContentKey}
          unsupportedReason={isPdf ? '暂不支持 PDF 搜索' : undefined}
          onOpenChange={setFindOpen}
        />
        <MarkdownToc
          containerRef={scrollContainerRef}
          contentKey={tocContentKey}
          enabled={Boolean(isMarkdown && !markdownEditing && tocOpen)}
        />
        <div ref={scrollContainerRef} onScroll={handleScroll} className="h-full flex-1 min-w-0 overflow-auto scrollbar-thin relative">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-[12px]">加载中...</div>
          ) : previewOnly ? (
            isPdf ? (
              pdfSrc ? (
                <div className="relative h-full">
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-2 py-1 rounded-lg bg-background/80 backdrop-filter backdrop-blur-sm border border-border/30 shadow-sm">
                  <button
                    type="button"
                    className="w-6 h-6 rounded border border-border/30 flex items-center justify-center text-sm text-muted-foreground hover:bg-muted/50"
                    onClick={() => pdfIframeRef.current?.contentWindow?.postMessage({ type: 'pdf-zoom', direction: 'out' }, '*')}
                  >−</button>
                  <span className="text-xs text-muted-foreground min-w-[40px] text-center font-mono">{pdfZoom}%</span>
                  <button
                    type="button"
                    className="w-6 h-6 rounded border border-border/30 flex items-center justify-center text-sm text-muted-foreground hover:bg-muted/50"
                    onClick={() => pdfIframeRef.current?.contentWindow?.postMessage({ type: 'pdf-zoom', direction: 'in' }, '*')}
                  >+</button>
                </div>
                <iframe
                  ref={pdfIframeRef}
                  src={pdfSrc}
                  className="w-full h-full border-0"
                  title={filePath.split('/').pop() || 'PDF'}
                />
              </div>
              ) : null
            ) : isImage ? (
              imageDataUrl ? (
                <div className="relative h-full">
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-2 py-1 rounded-lg bg-background/80 backdrop-blur-sm border border-border/30 shadow-sm">
                  <button
                    type="button"
                    className="w-6 h-6 rounded border border-border/30 flex items-center justify-center text-sm text-muted-foreground hover:bg-muted/50"
                    onClick={() => setImageZoom((z) => Math.max(0.1, z / 1.5))}
                  >−</button>
                  <span className="text-xs text-muted-foreground min-w-[40px] text-center font-mono">{Math.round(imageZoom * 100)}%</span>
                  <button
                    type="button"
                    className="w-6 h-6 rounded border border-border/30 flex items-center justify-center text-sm text-muted-foreground hover:bg-muted/50"
                    onClick={() => setImageZoom((z) => Math.min(5, z * 1.5))}
                  >+</button>
                </div>
                <div
                  ref={imageContainerRef}
                  className="h-full overflow-auto p-4 pt-12"
                  style={{ cursor: imageZoom > 1 ? (imageDragging.current ? 'grabbing' : 'grab') : 'default' }}
                  onMouseDown={(e) => {
                    if (imageZoom <= 1 || e.button !== 0) return
                    imageDragging.current = true
                    imageDragStart.current = { x: e.clientX, y: e.clientY, scrollLeft: e.currentTarget.scrollLeft, scrollTop: e.currentTarget.scrollTop }
                    e.currentTarget.style.cursor = 'grabbing'
                    const target = e.currentTarget
                    const onMove = (ev: MouseEvent) => {
                      if (!imageDragging.current) return
                      target.scrollLeft = imageDragStart.current.scrollLeft - (ev.clientX - imageDragStart.current.x)
                      target.scrollTop = imageDragStart.current.scrollTop - (ev.clientY - imageDragStart.current.y)
                    }
                    const onUp = () => {
                      imageDragging.current = false
                      target.style.cursor = 'grab'
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '100%', minHeight: '100%', width: imageNaturalSize.w > 0 ? imageNaturalSize.w * imageZoom : undefined, height: imageNaturalSize.h > 0 ? imageNaturalSize.h * imageZoom : undefined }}>
                    <img
                      src={imageDataUrl}
                      alt={filePath.split('/').pop() || 'Image'}
                      draggable={false}
                      onLoad={(e) => {
                        const img = e.currentTarget
                        setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
                      }}
                      style={{ width: imageNaturalSize.w > 0 ? imageNaturalSize.w * imageZoom : '100%', height: imageNaturalSize.h > 0 ? imageNaturalSize.h * imageZoom : 'auto', maxWidth: imageZoom <= 1 ? '100%' : 'none' }}
                    />
                  </div>
                </div>
              </div>
              ) : null
            ) : isDocx ? (
              docxHtml ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none px-4 py-3"
                  dangerouslySetInnerHTML={{ __html: docxHtml }}
                />
              ) : null
            ) : isOfficePreview ? (
              officeHtml ? (
                <div
                  className="office-preview-host"
                  dangerouslySetInnerHTML={{ __html: officeHtml }}
                />
              ) : null
            ) : isLegacyOffice ? null : isMarkdown ? (
              markdownEditing && markdownSourceMode ? (
                <textarea
                  value={markdownDraft}
                  onChange={(e) => setMarkdownDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      exitMarkdownEdit()
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void saveMarkdownEdit()
                    }
                  }}
                  autoFocus
                  spellCheck={false}
                  className="w-full min-h-full resize-none border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground outline-none focus:outline-none"
                />
              ) : (
                <MarkdownRichEditor
                  value={markdownEditing ? markdownDraft : newContent}
                  editing={markdownEditing}
                  onChange={setMarkdownDraft}
                  onSave={() => void saveMarkdownEdit()}
                  onCancel={exitMarkdownEdit}
                  onRequestEdit={startMarkdownEdit}
                  disabled={markdownSaving}
                  fileAccess={markdownFileAccess}
                  shikiTheme={theme === 'dark' ? 'github-dark' : 'github-light'}
                />
              )
            ) : isPlainTextEditable && markdownEditing ? (
              <textarea
                value={markdownDraft}
                onChange={(e) => setMarkdownDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    exitMarkdownEdit()
                  }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void saveMarkdownEdit()
                  }
                }}
                autoFocus
                spellCheck={false}
                className="w-full min-h-full resize-none border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground outline-none focus:outline-none"
              />
            ) : newContent ? (
              newContent.length > MAX_PREVIEW_CHARS ? (
                <pre className="p-3 text-[13px] leading-relaxed text-foreground/80 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {newContent.slice(0, MAX_PREVIEW_CHARS)}
                  <span className="text-muted-foreground block mt-2">
                    （文件过大，仅显示前 {MAX_PREVIEW_CHARS.toLocaleString()} 字符）
                  </span>
                </pre>
              ) : (
                <div className="h-full">
                  <PierreFile file={pierreFile} options={pierreOptions} />
                </div>
              )
            ) : (
              <pre className="p-3 text-[13px] leading-relaxed text-foreground/80 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">
                <span className="text-muted-foreground">（文件为空）</span>
              </pre>
            )
          ) : (
            <DiffView oldContent={oldContent} newContent={newContent} filePath={filePath} viewMode={viewMode} />
          )}
        </div>
      </div>
    </div>
  )
}
