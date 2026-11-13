/**
 * MermaidBlock - Mermaid 图表渲染组件
 *
 * 优先使用 beautiful-mermaid 渲染，遇到 beautiful-mermaid 不支持的图型时
 * 自动回退到官方 mermaid 渲染器。
 *
 * 渲染时序：
 *   流式输出 → 源码自然增长（零跳动）
 *   code 稳定 350ms → 后台 renderMermaid
 *   成功 → SVG 替换源码展示
 *   失败 → 保持源码展示
 *
 * 防竞态：generation 计数器，只有最新一代的渲染结果才会生效
 *
 * 缩放交互：仅头部按钮（缩小 / 重置 / 放大）。不响应滚轮和拖拽，
 * 让滚轮事件正常冒泡到页面滚动；放大后用容器原生 overflow scrollbar 浏览。
 *
 * 全屏预览：头部提供全屏按钮（Esc / 点击遮罩 / 头部按钮退出），
 * 在全屏遮罩内单独维护一份缩放比例与滚动位置，宽度受限的长图可以铺满窗口阅读。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import type { DiagramColors, RenderOptions } from 'beautiful-mermaid'
import { INITIAL_SCALE, toZoomPercent, zoomIn, zoomOut } from './zoom.ts'

interface MermaidBlockProps {
  /** mermaid 源码 */
  code: string
  /** 覆盖默认剪贴板实现（Electron 可注入主进程剪贴板） */
  onCopy?: (text: string) => Promise<void>
}

/** 防抖间隔（ms） */
const DEBOUNCE_MS = 350
let mermaidRenderId = 0

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

function getThemeOptions(themes: Record<string, DiagramColors>): RenderOptions {
  const colors = isDarkMode() ? themes['github-dark'] : themes['github-light']
  return colors ? { ...colors } : {}
}

function isUsableSvg(svg: unknown): svg is string {
  if (typeof svg !== 'string' || !svg.includes('<svg')) return false
  if (/(?:^|[^a-z])(?:NaN|Infinity|-Infinity)(?:[^a-z]|$)/i.test(svg)) return false
  // mermaid 解析失败时会返回带错误标记的 SVG，需要识别后走兜底
  if (svg.includes('aria-roledescription="error"')) return false
  if (svg.includes('class="error-text"')) return false
  return true
}

async function renderWithOfficialMermaid(code: string): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  const dark = isDarkMode()
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // 解析/绘制失败时清理临时节点并抛错，而非把错误图注入 document.body
    // （后者会在页面底部残留一条孤立的 "Syntax error in text" bar）
    suppressErrorRendering: true,
    theme: dark ? 'dark' : 'default',
    themeVariables: {
      background: dark ? '#0f172a' : '#ffffff',
      mainBkg: dark ? '#1e293b' : '#f8fafc',
      primaryColor: dark ? '#1e293b' : '#f8fafc',
      primaryTextColor: dark ? '#e2e8f0' : '#0f172a',
      primaryBorderColor: dark ? '#475569' : '#cbd5e1',
      lineColor: dark ? '#94a3b8' : '#64748b',
      textColor: dark ? '#e2e8f0' : '#0f172a',
    },
  })

  const id = `proma-mermaid-${Date.now()}-${mermaidRenderId++}`
  const { svg } = await mermaid.render(id, code)
  if (!isUsableSvg(svg)) throw new Error('Mermaid 输出了无效 SVG')
  return svg
}

async function renderMermaidSvg(code: string): Promise<string> {
  try {
    const { renderMermaidSVGAsync, THEMES } = await import('beautiful-mermaid')
    const svg = await renderMermaidSVGAsync(code, getThemeOptions(THEMES))
    if (isUsableSvg(svg)) return svg
  } catch {
    // beautiful-mermaid 只覆盖部分图型，不支持时交给官方 mermaid 兜底。
  }

  return renderWithOfficialMermaid(code)
}

// ===== 图标（与 CodeBlock 一致） =====

const ICON_ATTRS = {
  width: 14, height: 14, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}
const copyIconPath = (
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
)
const checkIconPath = <polyline points="20 6 9 17 4 12" />
const zoomInPath = (
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </>
)
const zoomOutPath = (
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </>
)
/** 展开：四角向外（进入全屏） */
const maximizePath = (
  <>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M16 3h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
  </>
)
/** 收起：四角向内（退出全屏） */
const minimizePath = (
  <>
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M16 3v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    <path d="M8 21v-3a2 2 0 0 0-2-2H3" />
  </>
)

// ===== 头部栏（内联卡片与全屏预览共用） =====

interface MermaidHeaderProps {
  /** 是否展示缩放控件（SVG 尚未渲染时只有复制） */
  showZoom: boolean
  /** 是否展示全屏入口（与缩放同步：没有 SVG 就没有可放大阅读的内容） */
  showFullscreen: boolean
  zoomPercent: number
  copied: boolean
  /** 当前是否处于全屏预览 */
  fullscreen: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onCopy: () => void
  onToggleFullscreen: () => void
}

function MermaidHeader({
  showZoom,
  showFullscreen,
  zoomPercent,
  copied,
  fullscreen,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onCopy,
  onToggleFullscreen,
}: MermaidHeaderProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between h-[34px] px-2 py-1 bg-muted/60 text-muted-foreground text-xs shrink-0">
      <span className="font-medium select-none">Mermaid</span>
      <div className="flex items-center gap-1">
        {showZoom && (
          <div className="flex items-center gap-0.5 mr-2">
            <button type="button" onClick={onZoomOut} className="p-0.5 rounded hover:bg-foreground/10 transition-colors" title="缩小">
              <svg {...ICON_ATTRS}>{zoomOutPath}</svg>
            </button>
            <button type="button" onClick={onZoomReset} className="px-1 py-0.5 rounded hover:bg-foreground/10 transition-colors min-w-[40px] text-center tabular-nums" title="重置缩放">
              {zoomPercent}%
            </button>
            <button type="button" onClick={onZoomIn} className="p-0.5 rounded hover:bg-foreground/10 transition-colors" title="放大">
              <svg {...ICON_ATTRS}>{zoomInPath}</svg>
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-foreground/10 transition-colors text-muted-foreground hover:text-foreground"
        >
          <svg {...ICON_ATTRS}>{copied ? checkIconPath : copyIconPath}</svg>
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
        {showFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-foreground/10 transition-colors text-muted-foreground hover:text-foreground"
            title={fullscreen ? '退出全屏（Esc）' : '全屏查看'}
            aria-label={fullscreen ? '退出全屏' : '全屏查看'}
          >
            <svg {...ICON_ATTRS}>{fullscreen ? minimizePath : maximizePath}</svg>
            <span>{fullscreen ? '退出全屏' : '全屏'}</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ===== 主组件 =====

export function MermaidBlock({ code, onCopy }: MermaidBlockProps): React.ReactElement {
  const [renderedSvg, setRenderedSvg] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [scale, setScale] = React.useState<number>(INITIAL_SCALE)
  const [fullscreenOpen, setFullscreenOpen] = React.useState(false)
  /** 全屏内单独维护缩放，避免把内联卡片的缩放状态带进大窗口 */
  const [fullscreenScale, setFullscreenScale] = React.useState<number>(INITIAL_SCALE)
  const fullscreenPanelRef = React.useRef<HTMLDivElement | null>(null)

  const codeRef = React.useRef(code)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** generation 计数器：每次 code 变化递增，防止异步竞态 */
  const generationRef = React.useRef(0)

  codeRef.current = code

  const renderCurrentCode = React.useCallback(async (generation: number) => {
    try {
      const svg = await renderMermaidSvg(codeRef.current)
      if (generationRef.current !== generation) return
      setRenderedSvg(svg)
    } catch {
      if (generationRef.current === generation) setRenderedSvg(null)
    }
  }, [])

  // ==== 唯一的渲染 effect：全部走防抖，generation 防竞态 ====
  React.useEffect(() => {
    // 每次 code 变化递增 generation，作废所有旧的异步渲染
    generationRef.current++
    const currentGen = generationRef.current

    if (debounceRef.current) clearTimeout(debounceRef.current)
    setRenderedSvg(null)
    setScale(INITIAL_SCALE)
    debounceRef.current = setTimeout(() => {
      void renderCurrentCode(currentGen)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [code, renderCurrentCode])

  // ---- 主题变化：重新渲染当前 code ----
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      generationRef.current++
      void renderCurrentCode(generationRef.current)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [renderCurrentCode])

  const handleZoomIn = React.useCallback(() => {
    setScale((prev) => zoomIn(prev))
  }, [])
  const handleZoomOut = React.useCallback(() => {
    setScale((prev) => zoomOut(prev))
  }, [])
  const handleZoomReset = React.useCallback(() => setScale(INITIAL_SCALE), [])

  const handleFullscreenZoomIn = React.useCallback(() => {
    setFullscreenScale((prev) => zoomIn(prev))
  }, [])
  const handleFullscreenZoomOut = React.useCallback(() => {
    setFullscreenScale((prev) => zoomOut(prev))
  }, [])
  const handleFullscreenZoomReset = React.useCallback(() => setFullscreenScale(INITIAL_SCALE), [])

  const closeFullscreen = React.useCallback(() => setFullscreenOpen(false), [])
  const toggleFullscreen = React.useCallback(() => {
    if (!fullscreenOpen) setFullscreenScale(INITIAL_SCALE)
    setFullscreenOpen(!fullscreenOpen)
  }, [fullscreenOpen])

  const handleCopy = React.useCallback(async () => {
    try {
      await (onCopy ? onCopy(code) : navigator.clipboard.writeText(code))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('[MermaidBlock] 复制失败:', error)
    }
  }, [code, onCopy])

  // ---- 全屏：Esc 退出、锁定背景滚动、把焦点交给面板 ----
  React.useEffect(() => {
    if (!fullscreenOpen) return undefined

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 抢占捕获阶段，避免 Esc 同时关掉外层弹层或中断当前输入
      event.stopPropagation()
      setFullscreenOpen(false)
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fullscreenPanelRef.current?.focus()

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreenOpen])

  // 源码变化导致重新渲染时，全屏里的内容会短暂消失，直接收起全屏更稳
  React.useEffect(() => {
    if (!renderedSvg) setFullscreenOpen(false)
  }, [renderedSvg])

  const zoomPercent = toZoomPercent(scale)
  const fullscreenZoomPercent = toZoomPercent(fullscreenScale)
  const canFullscreen = Boolean(renderedSvg)

  return (
    <div className="mermaid-block-wrapper group/mermaid rounded-lg overflow-hidden my-2 border border-border/50">
      {/* 头部栏 */}
      <MermaidHeader
        showZoom={canFullscreen}
        showFullscreen={canFullscreen}
        zoomPercent={zoomPercent}
        copied={copied}
        fullscreen={false}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onCopy={handleCopy}
        onToggleFullscreen={toggleFullscreen}
      />

      <div className="overflow-hidden">
        {!renderedSvg ? (
          <pre
            className="mermaid-block-scroll overflow-x-auto p-4 m-0 text-[13px] leading-[1.6] bg-muted/30 text-foreground/80"
          >
            <code>{code}</code>
          </pre>
        ) : (
          <div className="mermaid-block-scroll bg-background overflow-auto min-h-[180px]">
            <div className="flex w-max min-w-full items-center justify-start p-4 min-h-[180px]">
              <div
                className="mermaid-svg inline-block [&>svg]:block [&>svg]:h-auto"
                style={{ zoom: scale }}
                dangerouslySetInnerHTML={{ __html: renderedSvg }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 全屏预览：遮罩与 Dialog 保持一致的层级与配色 */}
      {fullscreenOpen && renderedSvg && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 animate-in fade-in-0 duration-200"
          role="dialog"
          aria-modal="true"
          aria-label="Mermaid 图表全屏预览"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeFullscreen()
          }}
        >
          <div
            ref={fullscreenPanelRef}
            tabIndex={-1}
            className="flex h-[88vh] w-[92vw] flex-col overflow-hidden rounded-lg border border-border/50 bg-background shadow-2xl outline-none animate-in fade-in-0 zoom-in-95 duration-200"
          >
            <MermaidHeader
              showZoom
              showFullscreen
              zoomPercent={fullscreenZoomPercent}
              copied={copied}
              fullscreen
              onZoomIn={handleFullscreenZoomIn}
              onZoomOut={handleFullscreenZoomOut}
              onZoomReset={handleFullscreenZoomReset}
              onCopy={handleCopy}
              onToggleFullscreen={closeFullscreen}
            />
            <div className="mermaid-block-scroll flex-1 overflow-auto overscroll-contain bg-background">
              <div className="flex min-h-full w-max min-w-full items-center justify-center p-8">
                <div
                  className="mermaid-svg inline-block [&>svg]:block [&>svg]:h-auto"
                  style={{ zoom: fullscreenScale }}
                  dangerouslySetInnerHTML={{ __html: renderedSvg }}
                />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
