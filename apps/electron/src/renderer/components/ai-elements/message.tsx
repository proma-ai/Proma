/**
 * AI Elements - 消息组件原语
 *
 * 简化迁移自 proma-frontend 的 ai-elements/message.tsx，
 * 保留核心消息展示组件，适配 Electron + Jotai 架构。
 *
 * 包含：
 * - Message — 根容器，`from` 属性区分 user/assistant
 * - MessageHeader — 头像 + 模型名
 * - MessageContent — 内容区域
 * - MessageActions — 操作按钮容器
 * - MessageAction — 单个操作按钮（可选 Tooltip）
 * - MessageResponse — react-markdown 渲染
 * - UserMessageContent — 长文本自动折叠
 * - MessageLoading — 3 个弹跳点加载动画
 * - MessageStopped — "已停止生成" 状态标记
 * - StreamingIndicator — 流式呼吸脉冲点
 */

import * as React from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { ChevronDown, ChevronUp, Paperclip, FileText, Sparkles, Server, Download, MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { shouldInspectMermaidCodeBlock, shouldRenderMermaidCodeBlock } from '@/lib/mermaid-detection'
import { normalizeLatexDelimiters } from '@/lib/normalize-latex'
import { Button } from '@/components/ui/button'
import { ImageLightbox, type LightboxImage } from '@/components/ui/image-lightbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { CodeBlock, MermaidBlock } from '@proma/ui'
import { detectLanguage } from '@proma/core'
import { FilePathChip, isAbsoluteFilePath, isRelativeFilePath } from './file-path-chip'
import type { HTMLAttributes, ComponentProps, ReactNode } from 'react'
import type { FileAttachment } from '@proma/shared'

// ===== Message 根容器 =====

type MessageRole = 'user' | 'assistant' | 'system'

interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  /** 消息发送者角色 */
  from: MessageRole
}

/** 消息根容器，user 自动右对齐 */
export function Message({ className, from, ...props }: MessageProps): React.ReactElement {
  return (
    <div
      className={cn(
        'message-item group flex w-full flex-col gap-0.5 rounded-[10px] px-2.5 py-2.5',
        from === 'user' ? 'is-user' : 'is-assistant',
        className
      )}
      {...props}
    />
  )
}

// ===== MessageHeader 头像 + 模型名 =====

interface MessageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** 模型名称 */
  model?: string
  /** 头像元素 */
  logo?: ReactNode
  /** 消息时间戳 */
  time?: string
}

/** 消息头部（user 时自动隐藏） */
export function MessageHeader({
  model,
  logo,
  time,
  className,
  children,
  ...props
}: MessageHeaderProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 mb-2.5',
        'group-[.is-user]:hidden',
        className
      )}
      {...props}
    >
      {logo && (
        <div className="flex size-[35px] shrink-0 items-center justify-center overflow-hidden rounded-[25%]">
          {logo}
        </div>
      )}
      <div className="flex flex-col justify-between h-[35px]">
        {model && <span className="text-sm font-semibold text-foreground/60 leading-none">{model}</span>}
        {time && <span className="message-time text-[10px] text-foreground/[0.38] leading-none">{time}</span>}
      </div>
      {children}
    </div>
  )
}

// ===== MessageContent 内容区域 =====

type MessageContentProps = HTMLAttributes<HTMLDivElement>

/**
 * 消息内容区域
 * - user 消息：pl-[46px] 与头像对齐 + 浅色气泡背景
 * - assistant 消息：pl-[46px] 与头像对齐
 */
export function MessageContent({
  children,
  className,
  ...props
}: MessageContentProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex max-w-full min-w-0 flex-col gap-2 overflow-hidden pl-[46px]',
        'group-[.is-user]:text-foreground group-[.is-user]:items-start',
        'group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ===== MessageActions 操作按钮容器 =====

type MessageActionsProps = ComponentProps<'div'>

/** 操作按钮容器（复制、删除等），默认显示淡色，hover 时加深 */
export function MessageActions({
  className,
  children,
  ...props
}: MessageActionsProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ===== MessageAction 单个操作按钮 =====

interface MessageActionProps extends ComponentProps<typeof Button> {
  /** 悬停提示文字 */
  tooltip?: string
  /** 无障碍标签 */
  label?: string
}

/** 单个操作按钮（含可选 Tooltip 包装） */
export function MessageAction({
  tooltip,
  children,
  label,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: MessageActionProps): React.ReactElement {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

// ===== MessageResponse Markdown 渲染 =====

// ----- mdast 节点类型（remark 自定义插件用） -----

interface MdastTextNode {
  type: 'text'
  value: string
}

interface MdastLinkNode {
  type: 'link'
  url: string
  children: MdastNode[]
}

interface MdastBreakNode {
  type: 'break'
}

interface MdastGenericNode {
  type: string
  children?: MdastNode[]
  value?: string
}

type MdastNode = MdastTextNode | MdastLinkNode | MdastBreakNode | MdastGenericNode

interface MdastParent {
  type: string
  children: MdastNode[]
}

// ----- mdast 工具函数 -----

/** 递归遍历 mdast text 节点（自动跳过 code / inlineCode 子树） */
function walkMdastText(
  node: MdastParent,
  visitor: (node: MdastTextNode, index: number, parent: MdastParent) => number | void
): void {
  if (!node.children) return
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!
    if (child.type === 'text') {
      const result = visitor(child as MdastTextNode, i, node)
      if (typeof result === 'number') i = result - 1
    } else if (child.type !== 'code' && child.type !== 'inlineCode') {
      const asParent = child as MdastParent
      if (asParent.children) walkMdastText(asParent, visitor)
    }
  }
}

// ----- MentionChip 组件 -----

type MentionType = 'file' | 'skill' | 'mcp' | 'session'

const MENTION_STYLES: Record<MentionType, { icon: typeof FileText; className: string }> = {
  file: { icon: FileText, className: 'bg-primary/10 text-primary' },
  skill: { icon: Sparkles, className: 'bg-[hsl(270_60%_60%/0.15)] text-[hsl(270_60%_50%)]' },
  mcp: { icon: Server, className: 'bg-[hsl(160_60%_45%/0.15)] text-[hsl(160_60%_35%)]' },
  session: { icon: MessageSquareText, className: 'bg-[hsl(200_80%_50%/0.14)] text-[hsl(200_80%_40%)]' },
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function MentionChip({ type, value }: { type: MentionType; value: string }): React.ReactElement {
  const style = MENTION_STYLES[type]
  const Icon = style.icon
  const decoded = safeDecode(value)
  const display = type === 'file'
    ? (decoded.split('/').pop() || decoded)
    : type === 'session'
      ? `会话 ${decoded.slice(0, 8)}`
      : decoded
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-[13px] font-medium whitespace-nowrap align-baseline',
        style.className
      )}
      title={type === 'file' || type === 'session' ? decoded : undefined}
    >
      <Icon className="size-3 inline shrink-0" />
      {display}
    </span>
  )
}

// ----- remarkMentions：将 @file: /skill: #mcp: &session: 转为 mention:// link 节点 -----

export function remarkMentions() {
  return (tree: MdastParent) => {
    walkMdastText(tree, (node, index, parent) => {
      const text = node.value
      // 每次调用创建独立正则实例，避免 /g 状态在并发 remark pipeline 间互相干扰
      const mentionPattern = /@file:(\S+)|\/skill:(\S+)|#mcp:(\S+)|&session:(\S+)/g
      if (!mentionPattern.test(text)) return
      mentionPattern.lastIndex = 0

      const parts: MdastNode[] = []
      let lastIdx = 0
      let m: RegExpExecArray | null

      while ((m = mentionPattern.exec(text)) !== null) {
        if (m.index > lastIdx) {
          parts.push({ type: 'text', value: text.slice(lastIdx, m.index) })
        }
        const mType: MentionType = m[1] ? 'file' : m[2] ? 'skill' : m[3] ? 'mcp' : 'session'
        const mValue = m[1] ?? m[2] ?? m[3] ?? m[4] ?? ''
        // 新版 htmlToMarkdown 已 encodeURIComponent，旧消息是原始路径
        const alreadyEncoded = /%[0-9A-Fa-f]{2}/.test(mValue)
        const safeValue = alreadyEncoded ? mValue : encodeURIComponent(mValue)
        parts.push({
          type: 'link',
          url: `mention://${mType}/${safeValue}`,
          children: [{ type: 'text', value: m[0] }],
        })
        lastIdx = m.index + m[0].length
      }

      if (lastIdx < text.length) {
        parts.push({ type: 'text', value: text.slice(lastIdx) })
      }

      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}

// ----- remarkPreserveBreaks：在 text 节点中将 \n 转为 break 节点（跳过代码块） -----

export function remarkPreserveBreaks() {
  return (tree: MdastParent) => {
    walkMdastText(tree, (node, index, parent) => {
      const text = node.value
      if (!text.includes('\n')) return

      const lines = text.split('\n')
      const parts: MdastNode[] = []

      for (let i = 0; i < lines.length; i++) {
        if (i > 0) parts.push({ type: 'break' })
        if (lines[i]) parts.push({ type: 'text', value: lines[i] })
      }

      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}

/** remark 插件函数签名 */
export type RemarkPluginFn = () => (tree: MdastParent) => void

/**
 * 附加 basePaths 上下文 — 用于把"附加目录候选"穿透到 MarkdownInlineCode 而不必逐层透传 props。
 * AgentMessages 在顶层用 BasePathsProvider 包裹，FilePathChip 渲染时会自动取到。
 */
const BasePathsContext = React.createContext<string[] | undefined>(undefined)

/** 提供附加目录候选给所有内嵌的 MessageResponse */
export function BasePathsProvider({ basePaths, children }: { basePaths?: string[]; children: React.ReactNode }): React.ReactElement {
  return <BasePathsContext.Provider value={basePaths}>{children}</BasePathsContext.Provider>
}

/**
 * 本轮「文件名 → 绝对路径」映射上下文 — 由 AssistantTurnRenderer 提供，作用域为单个 turn。
 * 正文里内联的文件引用往往只有裸文件名（如 `user-profile.md`），无法定位真实文档；
 * 命中本轮实际触及文件的映射时，MarkdownInlineCode 会把裸名补全为绝对路径，
 * 使其与 footer 文件 chip 走同一条可靠的绝对路径解析。未命中则维持原样降级。
 */
const TurnFileMapContext = React.createContext<Map<string, string> | undefined>(undefined)

/** 提供本轮文件名→绝对路径映射给所有内嵌的 MessageResponse */
export function TurnFileMapProvider({ map, children }: { map?: Map<string, string>; children: React.ReactNode }): React.ReactElement {
  return <TurnFileMapContext.Provider value={map}>{children}</TurnFileMapContext.Provider>
}

interface MessageResponseProps {
  /** Markdown 内容 */
  children: string
  className?: string
  /** 基础目录路径，用于解析相对文件路径（如 Agent 会话工作目录） */
  basePath?: string
  /** 额外的基础目录候选（如附加目录），点击 chip 时由主进程依次解析 */
  basePaths?: string[]
  /** 额外的 remark 插件（追加到内置 remarkGfm + remarkMath 之后） */
  remarkPlugins?: RemarkPluginFn[]
}

/** 稳定引用的插件数组，避免 react-markdown 每帧重建插件管线 */
const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

/** 允许 mention:// 协议通过 URL 清洗（react-markdown 默认只放行 http/https） */
function mentionUrlTransform(url: string): string {
  if (url.startsWith('mention://')) return url
  return defaultUrlTransform(url)
}

// ===== Memo'd Markdown 子组件（稳定引用，避免 react-markdown 每帧重建组件映射） =====

/** mention:// URL 匹配 */
const MENTION_URL_RE = /^mention:\/\/(file|skill|mcp|session)\/(.+)$/

/** 外部链接 / mention chip 渲染器 */
const MarkdownLink = React.memo(function MarkdownLink({
  href,
  children: linkChildren,
  ...linkProps
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  // mention:// 协议 → 渲染为 MentionChip
  if (href) {
    const mentionMatch = MENTION_URL_RE.exec(href)
    if (mentionMatch) {
      return <MentionChip type={mentionMatch[1] as MentionType} value={mentionMatch[2] ?? ''} />
    }
  }

  return (
    <a
      {...linkProps}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          window.electronAPI.openExternal(href)
        }
      }}
      title={href}
    >
      {linkChildren}
    </a>
  )
})

/** 递归提取纯文本（children 可能是字符串数组） */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

/** 代码块 / Mermaid 渲染器 */
const MarkdownPre = React.memo(function MarkdownPre({
  children: preChildren,
}: { children?: React.ReactNode }): React.ReactElement {
  // react-markdown v10 把 <code> 替换成自定义组件后，type 不再是字符串 'code'，
  // 但 pre 的 code child 要么是原生 'code'（v9 及之前），要么是自定义函数/对象组件（v10+）。
  // 通过 type 形态过滤掉意外混入的其他原生 HTML 元素（如 span/div），降低未来 react-markdown
  // 行为变化导致静默误识别的风险
  const codeChild = React.Children.toArray(preChildren).find(
    (child): child is React.ReactElement => {
      if (!React.isValidElement(child)) return false
      const t = (child as React.ReactElement).type
      return t === 'code' || typeof t === 'function' || typeof t === 'object'
    }
  ) as React.ReactElement | undefined

  if (codeChild) {
    const codeProps = codeChild.props as { className?: string; children?: React.ReactNode }
    const className = codeProps.className ?? ''
    const hasExplicitLang = /\blanguage-\S+/.test(className)

    // 先用共享 mermaid 识别（覆盖 language-mermaid/mmd 以及未标语言但内容像 Mermaid 的情况）
    if (shouldInspectMermaidCodeBlock(className)) {
      // normalize Windows/legacy-Mac line endings before feeding to Mermaid parser
      const mermaidCode = extractText(codeProps.children).replace(/\r\n?/g, '\n').replace(/\n$/, '')
      if (shouldRenderMermaidCodeBlock(className, mermaidCode)) {
        return <MermaidBlock code={mermaidCode} />
      }
    }

    // 未标注语言且非 Mermaid 时：highlight.js 自动检测，命中后注入 language-xxx 喂给 CodeBlock 高亮
    if (!hasExplicitLang) {
      const rawCode = extractText(codeProps.children).replace(/\n$/, '')
      const detected = detectLanguage(rawCode)
      if (detected !== 'text') {
        const patchedCode = React.cloneElement(codeChild, {
          className: `${className} language-${detected}`.trim(),
        } as Partial<React.HTMLAttributes<HTMLElement>>)
        return <CodeBlock>{patchedCode}</CodeBlock>
      }
    }
  }

  return <CodeBlock>{preChildren}</CodeBlock>
})

/** 行内代码 / 文件路径渲染器 */
const MarkdownInlineCode = React.memo(function MarkdownInlineCode({
  children: codeChildren,
  className: codeClassName,
  basePath,
  basePaths,
  ...codeProps
}: React.HTMLAttributes<HTMLElement> & { basePath?: string; basePaths?: string[] }): React.ReactElement {
  // 兜底：从 context 读附加 basePaths（避免穿透 SDKMessageRenderer / ContentBlock 等中间层）
  const ctxBasePaths = React.useContext(BasePathsContext)
  // 本轮「文件名 → 绝对路径」映射：命中时把内联裸文件名补全为绝对路径
  const turnFileMap = React.useContext(TurnFileMapContext)
  if (codeClassName) {
    return <code className={codeClassName} {...codeProps}>{codeChildren}</code>
  }

  const text = typeof codeChildren === 'string' ? codeChildren : ''

  if (text) {
    // 合并 basePath（主 cwd）+ basePaths（props 或 context 提供的附加目录）作为候选
    const merged: string[] = []
    if (basePath) merged.push(basePath)
    const allExtra = basePaths || ctxBasePaths
    if (allExtra) {
      for (const p of allExtra) {
        if (p && !merged.includes(p)) merged.push(p)
      }
    }
    if (isAbsoluteFilePath(text)) {
      return <FilePathChip filePath={text.trim()} basePaths={merged.length > 0 ? merged : undefined} />
    }
    if (merged.length > 0 && isRelativeFilePath(text)) {
      // 命中本轮实际触及文件的映射时，用绝对路径替换裸文件名（保留行号后缀），
      // 使内联引用与 footer chip 走同一条可靠解析；未命中则维持原样降级。
      const trimmed = text.trim()
      if (turnFileMap && turnFileMap.size > 0) {
        const lineColMatch = trimmed.match(/^(.+?)(:\d+(?::\d+)?)$/)
        const hasLineCol = !!lineColMatch && !lineColMatch[1]!.endsWith(':')
        const pathPart = hasLineCol ? lineColMatch![1]! : trimmed
        const suffix = hasLineCol ? lineColMatch![2]! : ''
        const baseName = pathPart.split(/[\\/]/).pop() || pathPart
        const abs = turnFileMap.get(baseName)
        if (abs) {
          return <FilePathChip filePath={abs + suffix} basePaths={merged} />
        }
      }
      return <FilePathChip filePath={trimmed} basePaths={merged} />
    }
  }

  return (
    <code
      className="rounded bg-foreground/10 px-[0.35em] py-[0.15em] text-[0.875em] font-mono font-medium"
      {...codeProps}
    >
      {codeChildren}
    </code>
  )
})

/** 使用 react-markdown 渲染 assistant 消息内容，代码块使用 Shiki 语法高亮 */
export const MessageResponse = React.memo(
  function MessageResponse({ children, className, basePath, basePaths, remarkPlugins }: MessageResponseProps): React.ReactElement {
    // 合并内置 + 外部 remark 插件（保持引用稳定）
    const mergedRemarkPlugins = React.useMemo(
      () => remarkPlugins ? [...REMARK_PLUGINS, ...remarkPlugins] : REMARK_PLUGINS,
      [remarkPlugins]
    )

    // 稳定引用的 components 对象，避免 react-markdown 每帧重建组件映射
    const components = React.useMemo(() => ({
      a: MarkdownLink,
      pre: MarkdownPre,
      code: (props: React.HTMLAttributes<HTMLElement>) => (
        <MarkdownInlineCode {...props} basePath={basePath} basePaths={basePaths} />
      ),
    }), [basePath, basePaths])

    return (
      <div
        className={cn(
          'prose dark:prose-invert max-w-none text-[length:var(--md-preview-font-size,15px)]',
          'prose-p:my-1.5 prose-p:leading-[1.6] prose-li:leading-[1.6] prose-pre:my-0 prose-headings:my-2 prose-hr:my-3',
          '[&_.code-block-wrapper+.code-block-wrapper]:mt-4',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
      >
        <Markdown
          remarkPlugins={mergedRemarkPlugins}
          rehypePlugins={REHYPE_PLUGINS}
          urlTransform={mentionUrlTransform}
          components={components}
        >
          {normalizeLatexDelimiters(children.replace(/<!--PROMA_AUTOMATION:[\s\S]*?-->/g, '').trim())}
        </Markdown>
      </div>
    )
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.basePath === nextProps.basePath &&
    prevProps.basePaths === nextProps.basePaths &&
    prevProps.remarkPlugins === nextProps.remarkPlugins
)

// ===== UserMessageContent 可折叠用户消息 =====

/** 折叠行数阈值 */
const COLLAPSE_LINE_THRESHOLD = 4

/** 用户消息专用 remark 插件（mention chip + 保留换行） */
const USER_REMARK_PLUGINS: RemarkPluginFn[] = [remarkMentions, remarkPreserveBreaks]

interface UserMessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children: string
}

/**
 * 用户消息内容组件
 * - 超过 4 行时默认折叠
 * - 点击展开/收起，底部使用低对比度文字提示
 */
export const UserMessageContent = React.memo(
  function UserMessageContent({ children, className, ...props }: UserMessageContentProps): React.ReactElement {
    const [isExpanded, setIsExpanded] = React.useState(false)
    const [shouldCollapse, setShouldCollapse] = React.useState(false)
    const contentRef = React.useRef<HTMLDivElement>(null)

    // 检测内容是否超过阈值行数
    React.useEffect(() => {
      if (!contentRef.current) return

      const element = contentRef.current
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight)
      const maxHeight = lineHeight * COLLAPSE_LINE_THRESHOLD

      // scrollHeight 超过最大高度 + 容差时折叠
      setShouldCollapse(element.scrollHeight > maxHeight + 10)
    }, [children])

    const toggleExpand = React.useCallback(() => {
      setIsExpanded((prev) => !prev)
    }, [])

    return (
      <div className={cn('relative inline-block max-w-full rounded-[10px] bg-primary/10 px-3.5 py-2.5', className)} {...props}>
        <div
          ref={contentRef}
          className={cn(
            'overflow-hidden transition-[max-height] duration-200',
            '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            shouldCollapse && !isExpanded && 'max-h-[6.5em]'
          )}
        >
          <MessageResponse className="prose-p:my-0.5 prose-headings:my-1.5" remarkPlugins={USER_REMARK_PLUGINS}>{children}</MessageResponse>
        </div>
        {shouldCollapse && (
          <button
            type="button"
            onClick={toggleExpand}
            className={cn(
              'mt-2 flex items-center gap-1 text-xs text-foreground/35 transition-colors',
              'hover:text-foreground/55'
            )}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-3" />
                <span>收起</span>
              </>
            ) : (
              <>
                <ChevronDown className="size-3" />
                <span>展开全部</span>
              </>
            )}
          </button>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

// ===== MessageLoading 加载动画 =====

type MessageLoadingProps = HTMLAttributes<HTMLDivElement> & { startedAt?: number }

/** 等待首个 chunk 的加载动画 */
export function MessageLoading({ className, startedAt, ...props }: MessageLoadingProps): React.ReactElement {
  return (
    <div className={cn('mt-0', className)} {...props}>
      <LoadingIndicator
        label="正在思考..."
        size="sm"
        showElapsed={startedAt || true}
        className="text-muted-foreground/60"
      />
    </div>
  )
}

// ===== MessageStopped 已停止生成 =====

type MessageStoppedProps = HTMLAttributes<HTMLDivElement>

/** "已停止生成" 状态标记 */
export function MessageStopped({ className, ...props }: MessageStoppedProps): React.ReactElement {
  return (
    <div
      className={cn('flex items-center gap-1.5 text-sm text-muted-foreground mt-2', className)}
      {...props}
    >
      <span className="size-2 rounded-full bg-muted-foreground/40" />
      <span>已停止生成</span>
    </div>
  )
}

// ===== MessageAttachments 消息附件展示 =====

interface MessageAttachmentsProps extends HTMLAttributes<HTMLDivElement> {
  /** 附件列表 */
  attachments: FileAttachment[]
  /** 图片编辑完成回调 */
  onImageEditComplete?: (editedDataUrl: string) => void
}

/** 消息附件容器 */
export function MessageAttachments({
  attachments,
  onImageEditComplete,
  className,
  ...props
}: MessageAttachmentsProps): React.ReactElement {
  const imageAttachments = attachments.filter((att) => att.mediaType.startsWith('image/'))
  const fileAttachments = attachments.filter((att) => !att.mediaType.startsWith('image/'))
  const isSingleImage = imageAttachments.length === 1 && fileAttachments.length === 0

  // 共享大图预览状态（多图可左右翻页）
  const [lightboxOpen, setLightboxOpen] = React.useState(false)
  const [lightboxIndex, setLightboxIndex] = React.useState(0)
  // 各图加载好的 src（key = attachment.id）——缩略图渲染时已加载，翻页复用不再触发 IO
  const [loadedSrcs, setLoadedSrcs] = React.useState<Record<string, string>>({})

  const handleLoaded = React.useCallback((id: string, src: string): void => {
    setLoadedSrcs((prev) => (prev[id] ? prev : { ...prev, [id]: src }))
  }, [])

  const openLightbox = React.useCallback((index: number): void => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }, [])

  // lightbox 图片列表（索引与 imageAttachments 对齐，每张带自己的保存/编辑回调）
  const lightboxImages = React.useMemo<LightboxImage[]>(
    () => imageAttachments.map((att) => ({
      src: loadedSrcs[att.id] ?? '',
      alt: att.filename,
      onSave: () => window.electronAPI.saveImageAs(att.localPath, att.filename),
      onEditComplete: onImageEditComplete,
    })),
    [imageAttachments, loadedSrcs, onImageEditComplete]
  )

  return (
    <div className={cn('flex flex-col gap-2 mb-2', className)} {...props}>
      {/* 图片附件 */}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {imageAttachments.map((att, index) => (
            <MessageAttachmentImage
              key={att.id}
              attachment={att}
              isSingle={isSingleImage}
              index={index}
              onOpen={openLightbox}
              onLoaded={handleLoaded}
            />
          ))}
        </div>
      )}
      {/* 文件附件 */}
      {fileAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileAttachments.map((att) => (
            <MessageAttachmentFile key={att.id} attachment={att} />
          ))}
        </div>
      )}
      {/* 共享大图预览 — 单图时无翻页，行为同以前 */}
      {imageAttachments.length > 0 && (
        <ImageLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          images={lightboxImages}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  )
}

// ===== MessageAttachmentImage 图片附件展示 =====

interface MessageAttachmentImageProps {
  attachment: FileAttachment
  /** 是否为唯一附件（单图模式） */
  isSingle?: boolean
  /** 该图在同批图片中的索引 */
  index: number
  /** 点击缩略图打开大图预览（第 index 张） */
  onOpen: (index: number) => void
  /** 图片 src 加载完成上报父组件（供共享 lightbox 翻页使用） */
  onLoaded: (id: string, src: string) => void
}

/** 图片附件展示（单图: max 500px，多图: 280px 方块），点击可预览大图 */
function MessageAttachmentImage({ attachment, isSingle = false, index, onOpen, onLoaded }: MessageAttachmentImageProps): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    window.electronAPI
      .readAttachment(attachment.localPath)
      .then((base64) => {
        const src = `data:${attachment.mediaType};base64,${base64}`
        setImageSrc(src)
        onLoaded(attachment.id, src)
      })
      .catch((error) => {
        console.error('[MessageAttachmentImage] 读取附件失败:', error)
      })
  }, [attachment.id, attachment.localPath, attachment.mediaType, onLoaded])

  /** 保存图片到本地 */
  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(attachment.localPath, attachment.filename)
  }, [attachment.localPath, attachment.filename])

  if (!imageSrc) {
    return (
      <div className={cn(
        'rounded-lg bg-muted/30 animate-pulse shrink-0',
        isSingle ? 'w-[280px] h-[200px]' : 'size-[280px]'
      )} />
    )
  }

  const imgElement = isSingle ? (
    <img
      src={imageSrc}
      alt={attachment.filename}
      className="max-w-[500px] max-h-[min(500px,50vh)] rounded-lg object-contain cursor-pointer"
      onClick={() => onOpen(index)}
    />
  ) : (
    <img
      src={imageSrc}
      alt={attachment.filename}
      className="size-[280px] rounded-lg object-cover shrink-0 cursor-pointer"
      onClick={() => onOpen(index)}
    />
  )

  return (
    <div className="relative group inline-block">
      {imgElement}
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        title="保存图片"
      >
        <Download className="size-4" />
      </button>
    </div>
  )
}

// ===== MessageAttachmentFile 文件附件展示 =====

interface MessageAttachmentFileProps {
  attachment: FileAttachment
}

/** 文件附件展示（标签样式，teal 色调） */
function MessageAttachmentFile({ attachment }: MessageAttachmentFileProps): React.ReactElement {
  /** 截断文件名 */
  const displayName = attachment.filename.length > 20
    ? attachment.filename.slice(0, 17) + '...'
    : attachment.filename

  return (
    <div className="flex items-center gap-2 rounded-lg bg-[#37a5aa]/10 border border-[#37a5aa]/20 px-3 py-1.5 text-[13px] text-[#37a5aa] shrink-0">
      <Paperclip className="size-4" />
      <span>{displayName}</span>
    </div>
  )
}

// ===== StreamingIndicator 流式呼吸脉冲点 =====

type StreamingIndicatorProps = HTMLAttributes<HTMLSpanElement>

/** 流式生成中的呼吸脉冲点指示器 */
export function StreamingIndicator({ className, ...props }: StreamingIndicatorProps): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full bg-primary/60 animate-pulse ml-1 align-middle',
        className
      )}
      {...props}
    />
  )
}
