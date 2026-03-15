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
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { ChevronDown, ChevronUp, Paperclip, FileText, Sparkles, Server, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { CodeBlock, MermaidBlock } from '@proma/ui'
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
        'group flex w-full flex-col gap-0.5 rounded-[10px] px-2.5 py-2.5',
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
        {time && <span className="text-[10px] text-foreground/[0.38] leading-none">{time}</span>}
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
        'flex w-full max-w-full min-w-0 flex-col gap-2 overflow-hidden pl-[46px]',
        'group-[.is-user]:text-foreground',
        'group-[.is-assistant]:text-foreground',
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

interface MessageResponseProps {
  /** Markdown 内容 */
  children: string
  className?: string
  /** 基础目录路径，用于解析相对文件路径（如 Agent 会话工作目录） */
  basePath?: string
}

/** 使用 react-markdown 渲染 assistant 消息内容，代码块使用 Shiki 语法高亮 */
export const MessageResponse = React.memo(
  function MessageResponse({ children, className, basePath }: MessageResponseProps): React.ReactElement {
    return (
      <div
        className={cn(
          'prose dark:prose-invert max-w-none text-[14px]',
          'prose-p:my-1.5 prose-p:leading-[1.6] prose-li:leading-[1.6] prose-pre:my-0 prose-headings:my-2',
          '[&_.code-block-wrapper+.code-block-wrapper]:mt-4',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
      >
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ href, children: linkChildren, ...linkProps }) => (
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
            ),
            pre: ({ children: preChildren }) => {
              // 检测子 <code> 元素的 className 是否包含 language-mermaid
              const codeChild = React.Children.toArray(preChildren).find(
                (child): child is React.ReactElement =>
                  React.isValidElement(child) && (child as React.ReactElement).type === 'code'
              ) as React.ReactElement | undefined

              if (codeChild) {
                const codeProps = codeChild.props as { className?: string; children?: React.ReactNode }
                if (codeProps.className?.includes('language-mermaid')) {
                  // 递归提取纯文本（children 可能是字符串数组）
                  const extractText = (node: React.ReactNode): string => {
                    if (typeof node === 'string') return node
                    if (typeof node === 'number') return String(node)
                    if (!node) return ''
                    if (Array.isArray(node)) return node.map(extractText).join('')
                    if (React.isValidElement(node)) {
                      return extractText((node.props as { children?: React.ReactNode }).children)
                    }
                    return ''
                  }
                  const mermaidCode = extractText(codeProps.children).replace(/\n$/, '')
                  return <MermaidBlock code={mermaidCode} />
                }
              }

              return <CodeBlock>{preChildren}</CodeBlock>
            },
            code: ({ children: codeChildren, className: codeClassName, ...codeProps }) => {
              // 仅处理行内代码（代码块内的 <code> 有 className="language-xxx"）
              if (codeClassName) {
                return <code className={codeClassName} {...codeProps}>{codeChildren}</code>
              }

              // 提取纯文本内容
              const text = typeof codeChildren === 'string' ? codeChildren : ''

              if (text) {
                // 检测绝对文件路径
                if (isAbsoluteFilePath(text)) {
                  return <FilePathChip filePath={text.trim()} />
                }

                // 检测相对文件路径（需要 basePath）
                if (basePath && isRelativeFilePath(text)) {
                  return <FilePathChip filePath={text.trim()} basePath={basePath} />
                }
              }

              // 默认渲染
              return <code {...codeProps}>{codeChildren}</code>
            },
          }}
        >
          {children}
        </Markdown>
      </div>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children && prevProps.basePath === nextProps.basePath
)

// ===== UserMessageContent 可折叠用户消息 =====

/** 折叠行数阈值 */
const COLLAPSE_LINE_THRESHOLD = 4

/** 将文本中的 @file:路径、/skill:名称、#mcp:名称 替换为样式化 chip */
const MENTION_RE = /@file:(\S+)|\/skill:(\S+)|#mcp:(\S+)/g

function renderTextWithMentions(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // 重置 lastIndex（全局正则复用时需要）
  MENTION_RE.lastIndex = 0

  while ((match = MENTION_RE.exec(text)) !== null) {
    // 添加 match 前的纯文本
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const key = `mention-${match.index}`

    if (match[1]) {
      // @file: 文件引用 — 蓝色 chip
      const filePath = match[1]
      const fileName = filePath.split('/').pop() || filePath
      parts.push(
        <span key={key} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary rounded px-1 py-[1px] text-[13px] font-medium whitespace-nowrap align-baseline" title={filePath}>
          <FileText className="size-3 inline shrink-0" />
          {fileName}
        </span>
      )
    } else if (match[2]) {
      // /skill: Skill 引用 — 紫色 chip
      const skillName = match[2]
      parts.push(
        <span key={key} className="inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-[13px] font-medium whitespace-nowrap align-baseline bg-[hsl(270_60%_60%/0.15)] text-[hsl(270_60%_50%)]">
          <Sparkles className="size-3 inline shrink-0" />
          {skillName}
        </span>
      )
    } else if (match[3]) {
      // #mcp: MCP 引用 — 绿色 chip
      const mcpName = match[3]
      parts.push(
        <span key={key} className="inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-[13px] font-medium whitespace-nowrap align-baseline bg-[hsl(160_60%_45%/0.15)] text-[hsl(160_60%_35%)]">
          <Server className="size-3 inline shrink-0" />
          {mcpName}
        </span>
      )
    }

    lastIndex = match.index + match[0].length
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

interface UserMessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children: string
}

/**
 * 用户消息内容组件
 * - 超过 4 行时默认折叠
 * - 点击展开/收起，带渐变遮罩
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
      <div className={cn('relative rounded-[10px] bg-foreground/[0.045] dark:bg-foreground/[0.08] px-3.5 py-2.5', shouldCollapse && !isExpanded && 'pb-6', className)} {...props}>
        <div
          ref={contentRef}
          className={cn(
            'whitespace-pre-wrap overflow-hidden transition-[max-height] duration-200 text-[14px] leading-[1.6]',
            '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            shouldCollapse && !isExpanded && 'max-h-[6.5em]'
          )}
        >
          {renderTextWithMentions(children)}
        </div>
        {shouldCollapse && (
          <button
            type="button"
            onClick={toggleExpand}
            className={cn(
              'flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors mt-1',
              !isExpanded &&
                'absolute bottom-0 left-0 right-0 px-3.5 pb-2.5 pt-4 rounded-b-[10px] bg-gradient-to-t from-foreground/[0.045] dark:from-foreground/[0.08] to-transparent'
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
}

/** 消息附件容器 */
export function MessageAttachments({
  attachments,
  className,
  ...props
}: MessageAttachmentsProps): React.ReactElement {
  const imageAttachments = attachments.filter((att) => att.mediaType.startsWith('image/'))
  const fileAttachments = attachments.filter((att) => !att.mediaType.startsWith('image/'))
  const isSingleImage = imageAttachments.length === 1 && fileAttachments.length === 0

  return (
    <div className={cn('flex flex-col gap-2 mb-2', className)} {...props}>
      {/* 图片附件 */}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {imageAttachments.map((att) => (
            <MessageAttachmentImage key={att.id} attachment={att} isSingle={isSingleImage} />
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
    </div>
  )
}

// ===== MessageAttachmentImage 图片附件展示 =====

interface MessageAttachmentImageProps {
  attachment: FileAttachment
  /** 是否为唯一附件（单图模式） */
  isSingle?: boolean
}

/** 图片附件展示（单图: max 500px，多图: 280px 方块） */
function MessageAttachmentImage({ attachment, isSingle = false }: MessageAttachmentImageProps): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    // 云端附件：直接使用 URL
    if (attachment.url) {
      setImageSrc(attachment.url)
      return
    }

    // 本地附件：通过 IPC 读取 base64
    if (attachment.localPath) {
      window.electronAPI
        .readAttachment(attachment.localPath)
        .then((base64) => {
          setImageSrc(`data:${attachment.mediaType};base64,${base64}`)
        })
        .catch((error) => {
          console.error('[MessageAttachmentImage] 读取附件失败:', error)
        })
    }
  }, [attachment.localPath, attachment.mediaType, attachment.url])

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
      className="max-w-[500px] max-h-[min(500px,50vh)] rounded-lg object-contain"
    />
  ) : (
    <img
      src={imageSrc}
      alt={attachment.filename}
      className="size-[280px] rounded-lg object-cover shrink-0"
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
