/**
 * TabPreviewPanel — Tab 悬浮预览面板
 *
 * 在 Tab hover 时向下弹出，显示：
 * 1. 对话标题
 * 2. 消息列表（复用 minimap 风格）
 * 无搜索、无最小条目限制。
 */

import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle } from 'lucide-react'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { getModelLogo } from '@/lib/model-logo'
import { cn } from '@/lib/utils'
import type { TabMinimapItem } from '@/atoms/tab-atoms'

interface TabPreviewPanelProps {
  title: string
  items: TabMinimapItem[]
  isLeaving: boolean
}

// ── Markdown 预览配置（轻量级） ──

const PREVIEW_REMARK_PLUGINS = [remarkGfm]

/* eslint-disable @typescript-eslint/no-explicit-any */
const PREVIEW_MD_COMPONENTS = {
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="text-[11px] opacity-70 truncate">{children}</pre>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="text-[11px] bg-muted/50 px-0.5 rounded">{children}</code>,
  img: () => null as unknown as React.ReactElement,
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
} as const
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── 子组件 ──

function ItemIcon({ item }: { item: TabMinimapItem }): React.ReactElement {
  if (item.role === 'user' && item.avatar) {
    return <UserAvatar avatar={item.avatar} size={16} className="mt-0.5" />
  }
  if (item.role === 'assistant' && item.model) {
    return (
      <img
        src={getModelLogo(item.model)}
        alt=""
        className="size-4 shrink-0 mt-0.5 rounded-[20%] object-cover"
      />
    )
  }
  if (item.role === 'status') {
    return <AlertTriangle className="size-4 shrink-0 mt-0.5 text-destructive" />
  }
  return <div className="size-4 shrink-0 mt-0.5 rounded-[20%] bg-muted" />
}

function Preview({ text }: { text: string }): React.ReactElement {
  if (!text) {
    return <span className="text-xs opacity-40">(空消息)</span>
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-popover-foreground/80 prose-p:my-0 prose-headings:my-0.5 prose-headings:text-xs prose-li:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 line-clamp-2 overflow-hidden">
      <Markdown remarkPlugins={PREVIEW_REMARK_PLUGINS} components={PREVIEW_MD_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
}

// ── 主组件 ──

export function TabPreviewPanel({ title, items, isLeaving }: TabPreviewPanelProps): React.ReactElement {
  return (
    <div
      className={cn(
        'w-[280px] rounded-lg border bg-popover shadow-xl origin-top flex flex-col overflow-hidden',
        isLeaving
          ? 'animate-out fade-out-0 zoom-out-95 duration-75'
          : 'animate-in fade-in-0 zoom-in-95 duration-150'
      )}
      style={{ maxHeight: 'min(420px, 60vh)' }}
    >
      {/* 标题栏 */}
      <div className="relative z-10 flex items-center justify-between px-3 py-2 border-b shrink-0 bg-popover">
        <span className="text-xs font-medium text-popover-foreground/90 truncate flex-1 min-w-0">
          {title}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums ml-2 shrink-0">
          {items.length}
        </span>
      </div>

      {/* 消息列表 */}
      <div className="overflow-y-auto flex-1 p-1.5 space-y-0.5 scrollbar-thin">
        {items.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            暂无消息
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2 w-full rounded-md px-2 py-1.5 text-left"
            >
              <ItemIcon item={item} />
              <div className="flex-1 min-w-0">
                <Preview text={item.preview} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
