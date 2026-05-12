/**
 * DiffTabContent — 单文件 Diff 或纯文件预览内容
 *
 * previewOnly=true 时：代码高亮预览（Shiki）或 Markdown 渲染
 * previewOnly=false（默认）：显示 git diff（旧版本 vs 磁盘）
 */

import * as React from 'react'
import { Code2, Copy, Check, Eye, Pencil, Save, X } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import { agentDiffViewModeAtom, agentDiffRefreshVersionAtom } from '@/atoms/agent-atoms'
import { resolvedThemeAtom } from '@/atoms/theme'
import { highlightCode } from '@proma/core'
import { DiffView } from './DiffView'
import { MarkdownRichEditor } from './MarkdownRichEditor'

/** 扩展名 → Shiki 语言 ID */
const EXT_LANG: Record<string, string> = {
  '.md': 'markdown', '.markdown': 'markdown',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',
  '.xml': 'xml', '.html': 'html', '.htm': 'html', '.svg': 'xml',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.ini': 'ini', '.env': 'bash',
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cs': 'csharp',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'fish',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.sql': 'sql', '.rb': 'ruby', '.php': 'php',
  '.diff': 'diff', '.patch': 'diff',
  '.txt': 'text', '.log': 'text', '.csv': 'text',
}

const MD_EXTS = new Set(['.md', '.markdown'])
const PDF_EXTS = new Set(['.pdf'])
const DOCX_EXTS = new Set(['.docx'])
const OFFICE_PREVIEW_EXTS = new Set(['.xlsx', '.pptx'])
const LEGACY_OFFICE_EXTS = new Set(['.doc', '.xls', '.ppt'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

/**
 * 简易 LRU 缓存：保留最近访问的 N 个 entries。
 * key 设计：
 * - diff 模式：`diff:${filePath}@v${refreshVersion}`
 * - preview 模式：`preview:${filePath}@v${refreshVersion}`
 * refreshVersion 变化时（agent 写文件、git 突变、窗口聚焦）key 自然变化，
 * 老 entry 不会被命中，最终被 LRU 淘汰；无需主动失效。
 */
type CacheEntry = {
  oldContent: string
  newContent: string
  highlightedHtml?: string
  highlightedLanguage?: string
  highlightedTheme?: string
}
const CACHE_MAX = 50
const MAX_HIGHLIGHT_CHARS = 200_000
const contentCache = new Map<string, CacheEntry>()
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

interface DiffTabContentProps {
  filePath: string
  dirPath: string
  sessionId: string
  gitRoot?: string
  previewOnly?: boolean
  /** 候选基础目录（previewOnly 模式下用于路径解析） */
  basePaths?: string[]
}

export function DiffTabContent({ filePath, dirPath, sessionId, gitRoot, previewOnly, basePaths }: DiffTabContentProps): React.ReactElement {
  const [viewMode, setViewMode] = useAtom(agentDiffViewModeAtom)
  const [oldContent, setOldContent] = React.useState('')
  const [newContent, setNewContent] = React.useState('')
  const [highlightedHtml, setHighlightedHtml] = React.useState('')
  const [markdownEditing, setMarkdownEditing] = React.useState(false)
  const [markdownSourceMode, setMarkdownSourceMode] = React.useState(false)
  const [markdownDraft, setMarkdownDraft] = React.useState('')
  const [markdownSaving, setMarkdownSaving] = React.useState(false)
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
  const [loading, setLoading] = React.useState(true)
  const [copied, setCopied] = React.useState(false)
  const refreshVersionMap = useAtomValue(agentDiffRefreshVersionAtom)
  const setRefreshVersionMap = useSetAtom(agentDiffRefreshVersionAtom)
  const refreshVersion = refreshVersionMap.get(sessionId) ?? 0
  const previewContentVersion = previewOnly ? refreshVersion : 0
  const theme = useAtomValue(resolvedThemeAtom)

  const ext = getExtension(filePath)
  const isMarkdown = previewOnly && MD_EXTS.has(ext)
  const isPdf = previewOnly && PDF_EXTS.has(ext)
  const isDocx = previewOnly && DOCX_EXTS.has(ext)
  const isOfficePreview = previewOnly && OFFICE_PREVIEW_EXTS.has(ext)
  const isLegacyOffice = previewOnly && LEGACY_OFFICE_EXTS.has(ext)
  const isImage = previewOnly && IMAGE_EXTS.has(ext)
  const fileAccess = React.useMemo(() => ({
    sessionId,
    candidateBasePaths: basePaths,
  }), [sessionId, basePaths])
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

  React.useEffect(() => {
    setMarkdownEditing(false)
    setMarkdownSourceMode(false)
    setMarkdownDraft('')
    setMarkdownSaving(false)
  }, [filePath, previewOnly])

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

  const shikiTheme = theme === 'dark' ? 'one-dark-pro' : 'one-light'

  // 上次加载的内容（refreshVersion 触发时用来对比是否变化）
  const lastNewContentRef = React.useRef('')
  const lastOldContentRef = React.useRef('')

  // 主加载 effect：上下文变化（filePath/dirPath/gitRoot/previewOnly）时触发；
  // 纯预览模式也跟随 refreshVersion 失效，保证同一文件二次写入后重新读盘。
  // 命中缓存时跳过 loading 闪烁直接渲染；未命中走 IPC 拉取
  React.useEffect(() => {
    let cancelled = false
    const lang = EXT_LANG[ext] || 'text'

    // PDF / DOCX / Office 不走文本缓存（HTML 体积大、解析过程也不轻）
    const cacheable = !isPdf && !isDocx && !isOfficePreview && !isLegacyOffice && !isImage
    const cacheKey = cacheable
      ? (previewOnly ? `preview:${filePath}@v${previewContentVersion}` : `diff:${filePath}@v${refreshVersion}`)
      : null
    const cached = cacheKey ? cacheGet(cacheKey) : undefined

    if (cached) {
      // 命中：直接同步渲染，不闪
      lastNewContentRef.current = cached.newContent
      lastOldContentRef.current = cached.oldContent
      setOldContent(cached.oldContent)
      setNewContent(cached.newContent)
      setHighlightedHtml(
        cached.highlightedHtml &&
          cached.highlightedLanguage === lang &&
          cached.highlightedTheme === shikiTheme
          ? cached.highlightedHtml
          : ''
      )
      setDocxHtml('')
      setOfficeHtml('')
      setOfficeText('')
      setPdfSrc('')
      setPdfZoom(100)
      setImagePath('')
      setImageDataUrl('')
      setImageZoom(0.25)
      setImageNaturalSize({ w: 0, h: 0 })
      setLoading(false)
    } else {
      setLoading(true)
      setOldContent('')
      setNewContent('')
      setHighlightedHtml('')
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
              setPdfSrc(result?.tmpHtmlUrl ?? '')
              return
            }
            if (isImage) {
              const resolved = await window.electronAPI.resolveFilePath(filePath, fileAccess)
              if (cancelled) return
              if (resolved) {
                setImagePath(filePath)
                setImageDataUrl(resolved.url)
              } else {
                setImagePath('')
                setImageDataUrl('')
              }
              return
            }
            if (isDocx) {
              const result = await window.electronAPI.docxToHtml(filePath, fileAccess)
              if (cancelled) return
              setDocxHtml(DOMPurify.sanitize(result?.html ?? ''))
              return
            }
            if (isOfficePreview) {
              const result = await window.electronAPI.officeToHtml(filePath, fileAccess)
              if (cancelled) return
              setOfficeHtml(DOMPurify.sanitize(result?.html ?? ''))
              setOfficeText(result?.text ?? '')
              return
            }
            if (isLegacyOffice) {
              return
            }
            const result = await window.electronAPI.resolveAndReadFile(filePath, fileAccess)
            if (cancelled) return
            content = result?.content ?? ''
          } else {
            const result = await window.electronAPI.getDiffContents({ dirPath, filePath, gitRoot, sessionId })
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

          if (
            cached?.highlightedHtml &&
            cached.highlightedLanguage === lang &&
            cached.highlightedTheme === shikiTheme
          ) {
            if (!cancelled) setHighlightedHtml(cached.highlightedHtml)
            return
          }

          if (content.length > MAX_HIGHLIGHT_CHARS) {
            if (!cancelled) setHighlightedHtml('')
            return
          }

          try {
            const hl = await highlightCode({ code: content, language: lang, theme: shikiTheme })
            if (cancelled) return
            const sanitizedHtml = DOMPurify.sanitize(hl.html)
            setHighlightedHtml(sanitizedHtml)
            if (cacheKey) {
              cacheSet(cacheKey, {
                oldContent: old,
                newContent: content,
                highlightedHtml: sanitizedHtml,
                highlightedLanguage: lang,
                highlightedTheme: shikiTheme,
              })
            }
          } catch (err) {
            console.error('[DiffTabContent] Shiki highlight failed:', err)
          }
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
  }, [filePath, dirPath, gitRoot, previewOnly, previewContentVersion, shikiTheme, fileAccess, isPdf, isDocx, isOfficePreview, isLegacyOffice, isImage, sessionId, ext])

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
        cacheSet(`diff:${filePath}@v${refreshVersion}`, { oldContent: oldC, newContent: newC })
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
  }, [refreshVersion, previewOnly, filePath, dirPath, gitRoot, sessionId])

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
    if (!isMarkdown) return
    setMarkdownDraft(newContent)
    setMarkdownSourceMode(false)
    setMarkdownEditing(true)
  }, [isMarkdown, newContent])

  const cancelMarkdownEdit = React.useCallback(() => {
    setMarkdownDraft(newContent)
    setMarkdownSourceMode(false)
    setMarkdownEditing(false)
  }, [newContent])

  const saveMarkdownEdit = React.useCallback(async () => {
    if (!isMarkdown || markdownSaving) return
    setMarkdownSaving(true)
    try {
      const ok = await window.electronAPI.writeTextFile(filePath, markdownDraft, fileAccess)
      if (!ok) {
        window.alert('保存失败：没有写入权限或文件不存在')
        return
      }
      lastNewContentRef.current = markdownDraft
      lastOldContentRef.current = ''
      setOldContent('')
      setNewContent(markdownDraft)
      cacheSet(`preview:${filePath}@v${refreshVersion + 1}`, { oldContent: '', newContent: markdownDraft })
      setRefreshVersionMap((prev) => {
        const m = new Map(prev)
        m.set(sessionId, (prev.get(sessionId) ?? 0) + 1)
        return m
      })
      setMarkdownSourceMode(false)
      setMarkdownEditing(false)
    } catch (err) {
      console.error('[DiffTabContent] Markdown save failed:', err)
      window.alert('保存失败')
    } finally {
      setMarkdownSaving(false)
    }
  }, [fileAccess, filePath, isMarkdown, markdownDraft, markdownSaving, refreshVersion, sessionId, setRefreshVersionMap])

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

        {previewOnly && isMarkdown && (
          markdownEditing ? (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMarkdownSourceMode((v) => !v)}
                disabled={markdownSaving}
                className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 disabled:opacity-50 shrink-0"
                title={markdownSourceMode ? '切换到富文本编辑' : '切换到源码编辑'}
              >
                {markdownSourceMode ? <Eye className="size-3.5" /> : <Code2 className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={cancelMarkdownEdit}
                disabled={markdownSaving}
                className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 disabled:opacity-50 shrink-0"
                title="取消编辑"
              >
                <X className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void saveMarkdownEdit()}
                disabled={markdownSaving}
                className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 disabled:opacity-50 shrink-0"
                title="保存"
              >
                <Save className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startMarkdownEdit}
              className="ml-auto p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 shrink-0"
              title="编辑 Markdown"
            >
              <Pencil className="size-3.5" />
            </button>
          )
        )}

        <button type="button" onClick={handleCopy}
          className={cn("p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/60 shrink-0", previewOnly && !isMarkdown && "ml-auto")}
          title="复制文件内容">
          {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin relative">
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
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-[12px] gap-1 px-4 text-center">
                <p>该 PDF 文件过大，无法在此预览</p>
                <p className="text-[11px] text-muted-foreground/60">请在系统中打开查看</p>
              </div>
            )
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
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-[12px] gap-1 px-4 text-center">
                {imagePath ? <p>加载中...</p> : (
                  <>
                    <p>该图片文件过大，无法在此预览</p>
                    <p className="text-[11px] text-muted-foreground/60">请在系统中打开查看</p>
                  </>
                )}
              </div>
            )
          ) : isDocx ? (
            docxHtml ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none px-4 py-3"
                dangerouslySetInnerHTML={{ __html: docxHtml }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-[12px]">无法加载 DOCX</div>
            )
          ) : isOfficePreview ? (
            officeHtml ? (
              <div
                className="office-preview-host"
                dangerouslySetInnerHTML={{ __html: officeHtml }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-[12px]">
                无法加载 {ext === '.pptx' ? 'PPTX' : 'Excel'} 预览
              </div>
            )
          ) : isLegacyOffice ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-[12px] gap-1 px-4 text-center">
              <p>暂不支持旧版 {ext.toUpperCase().slice(1)} 内联预览</p>
              <p className="text-[11px] text-muted-foreground/60">请在系统中打开，或转换为 {ext === '.xls' ? 'XLSX' : ext === '.ppt' ? 'PPTX' : 'DOCX'} 后预览</p>
            </div>
          ) : isMarkdown ? (
            markdownEditing && markdownSourceMode ? (
              <textarea
                value={markdownDraft}
                onChange={(e) => setMarkdownDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelMarkdownEdit()
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
                onCancel={cancelMarkdownEdit}
                onRequestEdit={startMarkdownEdit}
                disabled={markdownSaving}
                fileAccess={markdownFileAccess}
                shikiTheme={shikiTheme}
              />
            )
          ) : highlightedHtml ? (
            <div
              className="p-3 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!text-[13px]"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <pre className="p-3 text-[13px] leading-relaxed text-foreground/80 font-mono whitespace-pre-wrap break-words">
              {newContent || <span className="text-muted-foreground">（文件为空）</span>}
            </pre>
          )
        ) : (
          <DiffView oldContent={oldContent} newContent={newContent} filePath={filePath} viewMode={viewMode} />
        )}
      </div>
    </div>
  )
}
