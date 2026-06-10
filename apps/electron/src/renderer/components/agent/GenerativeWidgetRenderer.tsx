import * as React from 'react'
import { AlertTriangle, Code2, Loader2, Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GenerativeWidgetArtifact, GenerativeWidgetParseResult } from '@/lib/generative-ui-contract'
import {
  buildGenerativeWidgetSrcdoc,
  GENERATIVE_UI_IFRAME_SANDBOX,
  sanitizeGenerativeWidgetForIframe,
  sanitizeGenerativeWidgetForStreaming,
} from '@/lib/generative-ui-sandbox'

interface GenerativeWidgetRendererProps {
  parseResult: GenerativeWidgetParseResult
  isStreaming?: boolean
}

const MAX_IFRAME_HEIGHT = 2000
const STREAM_DEBOUNCE_MS = 120
const COMPACT_WIDGET_WIDTH_THRESHOLD = 560
const DEFAULT_COMPACT_WIDGET_WIDTH = 420
const heightCache = new Map<string, number>()

function heightCacheKey(artifact: GenerativeWidgetArtifact): string {
  return artifact.widgetCode.slice(0, 200)
}

type WidgetLayout = NonNullable<GenerativeWidgetArtifact['layout']>
type WidgetFramePresentation = 'inline' | 'expanded'

function extractPixelMaxWidth(widgetCode: string): number | undefined {
  const widths = [...widgetCode.matchAll(/max-width\s*:\s*(\d{2,4})px/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (widths.length === 0) return undefined
  return Math.max(...widths)
}

function resolveWidgetLayout(artifact: GenerativeWidgetArtifact): WidgetLayout {
  if (artifact.layout) return artifact.layout

  const naturalWidth = artifact.preferredWidth ?? extractPixelMaxWidth(artifact.widgetCode)
  const naturalHeight = artifact.initialHeight
  if (
    naturalWidth !== undefined
    && naturalWidth <= COMPACT_WIDGET_WIDTH_THRESHOLD
    && (naturalHeight === undefined || naturalHeight <= 520)
  ) {
    return 'compact'
  }

  return 'wide'
}

function resolveWidgetShellWidth(artifact: GenerativeWidgetArtifact, layout: WidgetLayout): number | undefined {
  if (layout === 'full') return undefined
  if (artifact.preferredWidth) return artifact.preferredWidth
  if (layout === 'compact') {
    return Math.min(
      extractPixelMaxWidth(artifact.widgetCode) ?? DEFAULT_COMPACT_WIDGET_WIDTH,
      COMPACT_WIDGET_WIDTH_THRESHOLD,
    )
  }
  return undefined
}

function useThemeStyleBlock(): string {
  return React.useMemo(() => {
    if (typeof document === 'undefined') return ''
    const styles = getComputedStyle(document.documentElement)
    const vars = [
      '--background',
      '--foreground',
      '--muted',
      '--muted-foreground',
      '--border',
      '--primary',
      '--primary-foreground',
      '--card',
      '--card-foreground',
    ]
    return `:root{${vars.map((name) => {
      const value = styles.getPropertyValue(name).trim()
      return value ? `${name}:${value};` : ''
    }).join('')}}`
  }, [])
}

function WidgetFrame({
  artifact,
  isStreaming = false,
  presentation = 'inline',
}: {
  artifact: GenerativeWidgetArtifact
  isStreaming?: boolean
  presentation?: WidgetFramePresentation
}): React.ReactElement {
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentRef = React.useRef('')
  const heightLockedRef = React.useRef(false)
  const [ready, setReady] = React.useState(false)
  const [scriptsReady, setScriptsReady] = React.useState(false)
  const [showCode, setShowCode] = React.useState(false)
  const [showExpanded, setShowExpanded] = React.useState(false)
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null)
  const [height, setHeight] = React.useState(() => {
    return heightCache.get(heightCacheKey(artifact)) ?? artifact.initialHeight ?? 180
  })
  const layout = React.useMemo(() => resolveWidgetLayout(artifact), [artifact])
  const shellWidth = React.useMemo(() => resolveWidgetShellWidth(artifact, layout), [artifact, layout])
  const shellStyle = shellWidth && presentation === 'inline' ? { maxWidth: `${shellWidth}px` } : undefined
  const frameHeight = presentation === 'expanded'
    ? Math.min(MAX_IFRAME_HEIGHT, Math.max(height, artifact.initialHeight ?? 720, 520))
    : height
  const styleBlock = useThemeStyleBlock()
  const srcDoc = React.useMemo(() => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    return buildGenerativeWidgetSrcdoc(styleBlock, isDark)
  }, [styleBlock])

  React.useEffect(() => {
    if (!showExpanded || typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowExpanded(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showExpanded])

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      if (!event.data || typeof event.data.type !== 'string') return
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) return
      if (event.data.type === 'widget:ready') {
        setReady(true)
        return
      }
      if (event.data.type === 'widget:scriptsReady') {
        setScriptsReady(true)
        return
      }
      if (event.data.type === 'widget:error') {
        const message = typeof event.data.message === 'string' ? event.data.message : 'Widget runtime error'
        setRuntimeError(message.slice(0, 500))
        return
      }
      if (event.data.type === 'widget:resize' && typeof event.data.height === 'number') {
        const next = Math.min(MAX_IFRAME_HEIGHT, Math.max(120, Math.round(event.data.height)))
        const key = heightCacheKey(artifact)
        setHeight((current) => {
          const resolved = heightLockedRef.current ? Math.max(current, next) : next
          heightCache.set(key, resolved)
          return resolved
        })
        return
      }
      if (event.data.type === 'widget:link') {
        const href = String(event.data.href ?? '')
        if (href && !/^\s*(javascript|data|vbscript|file)\s*:/i.test(href)) {
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [artifact])

  const postWidgetMessage = React.useCallback((type: 'widget:update' | 'widget:finalize', html: string): void => {
    const target = iframeRef.current?.contentWindow
    const messageKey = `${type}:${html}`
    if (!target || messageKey === lastSentRef.current) return
    setRuntimeError(null)
    lastSentRef.current = messageKey
    target.postMessage({ type, html }, '*')
  }, [])

  React.useEffect(() => {
    if (!ready || !isStreaming) return
    const html = sanitizeGenerativeWidgetForStreaming(artifact.widgetCode)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => postWidgetMessage('widget:update', html), STREAM_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [artifact.widgetCode, isStreaming, postWidgetMessage, ready])

  React.useEffect(() => {
    if (!ready || isStreaming) return
    const html = sanitizeGenerativeWidgetForIframe(artifact.widgetCode)
    heightLockedRef.current = true
    postWidgetMessage('widget:finalize', html)
    const unlock = setTimeout(() => {
      heightLockedRef.current = false
    }, 450)
    return () => clearTimeout(unlock)
  }, [artifact.widgetCode, isStreaming, postWidgetMessage, ready])

  React.useEffect(() => {
    if (!ready || typeof document === 'undefined') return
    const sendTheme = (): void => {
      const styles = getComputedStyle(document.documentElement)
      const vars = [
        '--background',
        '--foreground',
        '--muted',
        '--muted-foreground',
        '--border',
        '--primary',
        '--primary-foreground',
        '--card',
        '--card-foreground',
      ].reduce<Record<string, string>>((acc, name) => {
        const value = styles.getPropertyValue(name).trim()
        if (value) acc[name] = value
        return acc
      }, {})
      iframeRef.current?.contentWindow?.postMessage({
        type: 'widget:theme',
        vars,
        isDark: document.documentElement.classList.contains('dark'),
      }, '*')
    }
    sendTheme()
    const observer = new MutationObserver(sendTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => observer.disconnect()
  }, [ready])

  return (
    <>
      <div
        className={cn(
          'max-w-full overflow-hidden rounded-lg border border-border/60 bg-card/70 shadow-sm',
          presentation === 'inline' ? 'my-2' : 'my-0',
          shellWidth && presentation === 'inline' && 'mx-auto w-full',
        )}
        style={shellStyle}
      >
        <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border/50 px-3 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-card-foreground">{artifact.title}</div>
            {artifact.description && (
              <div className="truncate text-xs text-muted-foreground">{artifact.description}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!scriptsReady && !isStreaming && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setShowCode((current) => !current)}
              aria-label="查看生成代码"
            >
              <Code2 className="size-3.5" />
            </button>
            {presentation === 'inline' && (
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setShowExpanded(true)}
                aria-label="放大查看生成式 UI"
              >
                <Maximize2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <iframe
          ref={iframeRef}
          sandbox={GENERATIVE_UI_IFRAME_SANDBOX}
          srcDoc={srcDoc}
          title={artifact.title}
          className="block w-full border-0 bg-transparent"
          style={{ height: frameHeight, transition: 'height 160ms ease-out' }}
          onLoad={() => setReady(true)}
        />
        {runtimeError && (
          <div
            role="alert"
            className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">Widget runtime error: {runtimeError}</span>
          </div>
        )}
        {showCode && (
          <pre className="max-h-64 overflow-auto border-t border-border/50 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <code>{artifact.widgetCode}</code>
          </pre>
        )}
      </div>

      {showExpanded && presentation === 'inline' && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col bg-background/95 text-foreground backdrop-blur-sm titlebar-no-drag"
          role="dialog"
          aria-modal="true"
          aria-label={`${artifact.title} 全屏查看`}
        >
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-card-foreground">{artifact.title}</div>
              {artifact.description && (
                <div className="truncate text-xs text-muted-foreground">{artifact.description}</div>
              )}
            </div>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setShowExpanded(false)}
              aria-label="关闭全屏查看"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            <div className="mx-auto w-full max-w-[min(1400px,calc(100vw-32px))]">
              <WidgetFrame artifact={artifact} isStreaming={isStreaming} presentation="expanded" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function GenerativeWidgetRenderer({ parseResult, isStreaming }: GenerativeWidgetRendererProps): React.ReactElement {
  if (!parseResult.ok) {
    return (
      <div className="my-2 flex max-w-full items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">{parseResult.title ?? '生成式 UI'} 无法渲染</div>
          <div className="break-words text-xs opacity-85">{parseResult.reason}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(isStreaming && 'opacity-95')}>
      <WidgetFrame artifact={parseResult.artifact} isStreaming={isStreaming} />
    </div>
  )
}
