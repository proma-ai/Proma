import * as React from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  CodeSquare,
  Minus,
  Link as LinkIcon,
  Table as TableIcon,
  Unlink,
  Camera,
  Copy,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { SCREENSHOT_LIMITS } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

interface MarkdownEditorToolbarProps {
  editor: Editor
}

interface ToolbarActiveState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
  heading1: boolean
  heading2: boolean
  heading3: boolean
  bulletList: boolean
  orderedList: boolean
  taskList: boolean
  blockquote: boolean
  codeBlock: boolean
  link: boolean
}

/**
 * 收集渲染端已编译的 CSS（含 Tailwind 输出 + globals.css）。
 * 跨域 / file: 协议的 sheet 读 cssRules 会抛，捕获后跳过。
 */
function collectRuntimeStyles(): string {
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules
      if (!rules) continue
      for (const rule of Array.from(rules)) {
        chunks.push(rule.cssText)
      }
    } catch {
      // 无法访问的 sheet（CORS / 跨域字体表）跳过
    }
  }
  return chunks.join('\n')
}

function buildScreenshotPayload(editor: Editor): {
  html: string
  width: number
  css: string
  themeClass: string
} {
  const root = editor.view.dom

  // 预检：早失败，避免昂贵工作白做
  const elementCount = root.querySelectorAll('*').length
  if (elementCount > SCREENSHOT_LIMITS.MAX_ELEMENTS) {
    throw new Error('文档结构过于复杂，请缩短内容后重试')
  }
  if (root.outerHTML.length > SCREENSHOT_LIMITS.MAX_RAW_HTML_BYTES) {
    throw new Error('文档过大，请缩短内容后重试')
  }

  // 克隆 DOM，但不再逐元素 inline computed style——
  // 直接把渲染端运行时的 CSS 整体注入到截图 HTML，由浏览器自然层叠。
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[contenteditable]').forEach((el) => {
    el.removeAttribute('contenteditable')
  })
  clone.querySelectorAll('[spellcheck]').forEach((el) => {
    el.removeAttribute('spellcheck')
  })

  const rect = root.getBoundingClientRect()
  const width = Math.max(
    SCREENSHOT_LIMITS.MIN_WIDTH,
    Math.min(SCREENSHOT_LIMITS.MAX_WIDTH, Math.ceil(rect.width || 960)),
  )
  clone.style.width = `${width}px`
  clone.style.height = 'auto'
  clone.style.maxHeight = 'none'
  clone.style.overflow = 'visible'
  clone.setAttribute('data-proma-screenshot-root', 'true')

  // 透传主题 class（dark / theme-ocean-dark / theme-forest-dark 等），
  // 确保 globals.css 里基于这些 class 的 CSS 变量在截图侧也生效
  const themeClass = document.documentElement.className

  return {
    html: clone.outerHTML,
    width,
    css: collectRuntimeStyles(),
    themeClass,
  }
}

function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: React.ElementType
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('h-7 w-7', active && 'bg-accent text-accent-foreground')}
          disabled={disabled}
          onClick={(e) => {
            e.preventDefault()
            onClick()
          }}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}{shortcut && <span className="ml-1.5 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function TableGridPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = React.useState(false)
  const [hover, setHover] = React.useState({ row: 0, col: 0 })

  const insert = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="h-7 w-7">
              <TableIcon className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">插入表格</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-auto p-2">
        <div className="mb-1.5 text-center text-xs text-muted-foreground">
          {hover.row > 0 ? `${hover.row} × ${hover.col}` : '选择大小'}
        </div>
        <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {Array.from({ length: 36 }, (_, i) => {
            const r = Math.floor(i / 6) + 1
            const c = (i % 6) + 1
            const selected = r <= hover.row && c <= hover.col
            return (
              <div
                key={i}
                className={cn(
                  'h-4 w-4 cursor-pointer rounded-sm border',
                  selected ? 'border-primary bg-primary/20' : 'border-border bg-background hover:border-primary/50',
                )}
                onMouseEnter={() => setHover({ row: r, col: c })}
                onClick={() => insert(r, c)}
              />
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LinkPopover({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      const existingHref = editor.getAttributes('link').href
      setUrl(existingHref || '')
    }
    setOpen(isOpen)
  }

  const apply = () => {
    if (url) {
      editor.chain().focus().setLink({ href: url }).run()
    } else {
      editor.chain().focus().unsetLink().run()
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn('h-7 w-7', active && 'bg-accent text-accent-foreground')}
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">链接 <span className="text-muted-foreground">⌘K</span></TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-72 p-2">
        <div className="flex gap-1.5">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
            placeholder="https://..."
            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
            autoFocus
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={apply}>
            确认
          </Button>
          {active && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 text-destructive"
              onClick={() => {
                editor.chain().focus().unsetLink().run()
                setOpen(false)
              }}
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function MarkdownEditorToolbar({ editor }: MarkdownEditorToolbarProps): React.ReactElement {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform
  const isMac = platform.includes('Mac')
  const mod = isMac ? '⌘' : 'Ctrl+'
  const [screenshotting, setScreenshotting] = React.useState(false)
  const screenshottingRef = React.useRef(false)
  const activeState = useEditorState<ToolbarActiveState>({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor.isActive('bold'),
      italic: currentEditor.isActive('italic'),
      underline: currentEditor.isActive('underline'),
      strike: currentEditor.isActive('strike'),
      code: currentEditor.isActive('code'),
      heading1: currentEditor.isActive('heading', { level: 1 }),
      heading2: currentEditor.isActive('heading', { level: 2 }),
      heading3: currentEditor.isActive('heading', { level: 3 }),
      bulletList: currentEditor.isActive('bulletList'),
      orderedList: currentEditor.isActive('orderedList'),
      taskList: currentEditor.isActive('taskList'),
      blockquote: currentEditor.isActive('blockquote'),
      codeBlock: currentEditor.isActive('codeBlock'),
      link: currentEditor.isActive('link'),
    }),
  })

  const handleScreenshot = React.useCallback(async (mode: 'clipboard' | 'file') => {
    // ref 做同步重入锁，state 仅驱动 UI——state 在同 tick 内的 setState 不会立即生效，
    // 用作 guard 会漏检同一 tick 内的二次触发（键盘 + 点击同时发生等情况）。
    if (screenshottingRef.current) return
    screenshottingRef.current = true
    setScreenshotting(true)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const { html, width, css, themeClass } = buildScreenshotPayload(editor)
      const isDark = document.documentElement.classList.contains('dark')
      const result = await window.electronAPI.screenshotCapture({ html, isDark, width, mode, css, themeClass })
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.warning(result.message)
      }
    } catch (err) {
      console.error('[截图] 失败:', err)
      toast.error(err instanceof Error ? err.message : '截图失败')
    } finally {
      screenshottingRef.current = false
      setScreenshotting(false)
    }
  }, [editor])

  const handleScreenshotClipboard = React.useCallback(() => {
    void handleScreenshot('clipboard')
  }, [handleScreenshot])

  const handleScreenshotFile = React.useCallback(() => {
    void handleScreenshot('file')
  }, [handleScreenshot])

  return (
    <div className="sticky top-0 z-10 flex items-center gap-0.5 border-b border-border/50 bg-background px-2 py-1">
      {/* 行内格式 */}
      <ToolbarButton icon={Bold} label="加粗" shortcut={`${mod}B`} active={activeState.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarButton icon={Italic} label="斜体" shortcut={`${mod}I`} active={activeState.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarButton icon={UnderlineIcon} label="下划线" shortcut={`${mod}U`} active={activeState.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolbarButton icon={Strikethrough} label="删除线" shortcut={`${mod}⇧X`} active={activeState.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <ToolbarButton icon={Code} label="行内代码" shortcut={`${mod}E`} active={activeState.code} onClick={() => editor.chain().focus().toggleCode().run()} />

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      {/* 标题 */}
      <ToolbarButton icon={Heading1} label="标题 1" active={activeState.heading1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
      <ToolbarButton icon={Heading2} label="标题 2" active={activeState.heading2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <ToolbarButton icon={Heading3} label="标题 3" active={activeState.heading3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      {/* 列表 */}
      <ToolbarButton icon={List} label="无序列表" active={activeState.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolbarButton icon={ListOrdered} label="有序列表" active={activeState.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolbarButton icon={ListChecks} label="任务列表" active={activeState.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()} />

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      {/* 块元素 */}
      <ToolbarButton icon={Quote} label="引用" active={activeState.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <ToolbarButton icon={CodeSquare} label="代码块" active={activeState.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <ToolbarButton icon={Minus} label="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()} />

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      {/* 插入 */}
      <LinkPopover editor={editor} active={activeState.link} />
      <TableGridPicker editor={editor} />

      <div className="flex-1" />

      {/* 截图导出 */}
      {screenshotting && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="mr-1 flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="截图处理中" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            生成截图中
          </TooltipContent>
        </Tooltip>
      )}
      <ToolbarButton
        icon={Copy}
        label="截图到剪贴板"
        disabled={screenshotting}
        onClick={handleScreenshotClipboard}
      />
      <ToolbarButton
        icon={Camera}
        label="截图保存文件"
        disabled={screenshotting}
        onClick={handleScreenshotFile}
      />
    </div>
  )
}
