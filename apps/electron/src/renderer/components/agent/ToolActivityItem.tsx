/**
 * ToolActivityItem — 紧凑列表式工具活动展示
 *
 * 核心设计：
 * - 收起行：语义化短语（如 "读取 foo.ts 第 10-60 行"），替代工具名 + Badge + 摘要
 * - 展开面板：按工具类型结构化渲染结果，无输入区
 * - Loading 态：语义化进行时（如 "正在读取 foo.ts..."）
 * - Task/Agent 子代理折叠分组 + 左边框层级
 * - CSS 动画（交错入场 / 状态切换）
 */

import * as React from 'react'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ChevronRight,
  MessageCircleDashed,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolIcon, formatElapsed } from './tool-utils'
import { getToolPhrase } from './tool-phrase'
import { ToolResultRenderer } from './tool-result-renderers'
import {
  type ToolActivity,
  type ActivityGroup,
  type ActivityStatus,
  getActivityStatus,
  groupActivities,
  isActivityGroup,
} from '@/atoms/agent-atoms'

// ===== 尺寸配置 =====

const SIZE = {
  icon: 'size-2.5',
  spinner: 'size-2',
  row: 'py-[2px]',
  staggerLimit: 10,
  autoScrollThreshold: 6,
  rowHeight: 22,
} as const

// ===== 状态图标 =====

function StatusIcon({ status, toolName }: { status: ActivityStatus; toolName?: string }): React.ReactElement {
  const key = `${status}-${toolName}`

  if (status === 'running' || status === 'backgrounded') {
    return (
      <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
        <Loader2 className={cn(SIZE.spinner, 'animate-spin', status === 'backgrounded' ? 'text-primary' : 'text-blue-500')} />
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
        <XCircle className={cn(SIZE.icon, 'text-destructive')} />
      </span>
    )
  }

  if (status === 'completed') {
    const ToolIcon = toolName ? getToolIcon(toolName) : null
    if (ToolIcon && (toolName === 'Edit' || toolName === 'Write')) {
      return (
        <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
          <ToolIcon className={cn(SIZE.icon, 'text-primary')} />
        </span>
      )
    }
    return (
      <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
        <CheckCircle2 className={cn(SIZE.icon, 'text-green-500')} />
      </span>
    )
  }

  return (
    <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center')}>
      <Circle className={cn(SIZE.icon, 'text-muted-foreground/50')} />
    </span>
  )
}

// ===== 错误 Badge =====

function ErrorBadge(): React.ReactElement {
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-destructive/5 text-destructive font-medium leading-none shadow-sm">
      Error
    </span>
  )
}

// ===== TodoWrite 可视化 =====

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

function parseTodoItems(input: Record<string, unknown>): TodoItem[] | null {
  if (input.todos && Array.isArray(input.todos)) {
    return (input.todos as Array<Record<string, unknown>>).map((t) => ({
      content: String(t.subject ?? t.content ?? ''),
      status: (t.status as TodoItem['status']) ?? 'pending',
      activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
    }))
  }
  return null
}

function TodoList({ items }: { items: TodoItem[] }): React.ReactElement {
  return (
    <div className="pl-5 space-y-0.5 border-l-2 border-muted ml-[5px]">
      {items.map((todo, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-2 text-[13px]',
            SIZE.row,
            todo.status === 'completed' && 'opacity-50',
          )}
        >
          {todo.status === 'pending' && <Circle className={cn(SIZE.icon, 'text-muted-foreground/50')} />}
          {todo.status === 'in_progress' && <Loader2 className={cn(SIZE.spinner, 'animate-spin text-blue-500')} />}
          {todo.status === 'completed' && <CheckCircle2 className={cn(SIZE.icon, 'text-green-500')} />}
          <span className={cn('truncate flex-1', todo.status === 'completed' && 'line-through')}>
            {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
          </span>
        </div>
      ))}
    </div>
  )
}

// ===== 活动行 =====

export interface ActivityRowProps {
  activity: ToolActivity
  index?: number
  animate?: boolean
  onOpenDetails?: (activity: ToolActivity) => void
}

export function ActivityRow({ activity, index = 0, animate = false, onOpenDetails }: ActivityRowProps): React.ReactElement {
  const status = getActivityStatus(activity)
  const phrase = getToolPhrase(activity.toolName, activity.input)
  const isRunning = status === 'running' || status === 'backgrounded'

  // 运行中显示进行时短语，完成后显示完成态短语
  const displayLabel = isRunning ? phrase.loadingLabel : phrase.label

  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'

  const canExpand = !!onOpenDetails && activity.done && !!(activity.result || Object.keys(activity.input).length > 0)

  return (
    <div
      className={cn(
        'group/row flex items-center gap-1.5 text-[12px] rounded-md',
        SIZE.row,
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      {canExpand ? (
        <button
          type="button"
          className="group/expand shrink-0 flex items-center gap-1.5 cursor-pointer min-w-0 flex-1"
          onClick={(e) => { e.stopPropagation(); onOpenDetails(activity) }}
        >
          <StatusIcon status={status} toolName={activity.toolName} />
          <span className="truncate text-foreground/80 group-hover/expand:text-foreground transition-colors duration-150 flex-1">{displayLabel}</span>
          {activity.isError && <ErrorBadge />}
          {activity.elapsedSeconds !== undefined && activity.elapsedSeconds > 0 && (
            <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
              {formatElapsed(activity.elapsedSeconds)}
            </span>
          )}
          <ChevronRight className={cn(SIZE.icon, 'shrink-0 text-muted-foreground/40 group-hover/expand:text-foreground/60 transition-colors duration-150')} />
        </button>
      ) : (
        <>
          <StatusIcon status={status} toolName={activity.toolName} />
          <span className="truncate text-foreground/80">{displayLabel}</span>
          {activity.isError && <ErrorBadge />}
          {activity.elapsedSeconds !== undefined && activity.elapsedSeconds > 0 && (
            <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
              {formatElapsed(activity.elapsedSeconds)}
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ===== Task 分组行 =====

interface ActivityGroupRowProps {
  group: ActivityGroup
  index?: number
  animate?: boolean
  onOpenDetails?: (activity: ToolActivity) => void
  detailsId?: string | null
  onCloseDetails?: () => void
}

function ActivityGroupRow({ group, index = 0, animate = false, onOpenDetails, detailsId, onCloseDetails }: ActivityGroupRowProps): React.ReactElement {
  const { parent, children } = group
  // Agent 子代理默认折叠，Task 子代理默认展开
  const [expanded, setExpanded] = React.useState(parent.toolName !== 'Agent')

  const derivedStatus = React.useMemo((): ActivityStatus => {
    const selfStatus = getActivityStatus(parent)
    if (selfStatus === 'completed' || selfStatus === 'error') return selfStatus
    if (children.length > 0 && children.every((c) => c.done)) {
      if (children.some((c) => c.isError)) return 'error'
      if (parent.done) return 'completed'
    }
    return selfStatus
  }, [parent, children])

  const phrase = getToolPhrase(parent.toolName, parent.input)
  const isRunning = derivedStatus === 'running' || derivedStatus === 'backgrounded'
  const displayLabel = isRunning ? phrase.loadingLabel : phrase.label

  const subagentType = typeof parent.input.subagent_type === 'string'
    ? parent.input.subagent_type
    : undefined

  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'

  return (
    <div
      className={cn(
        'w-full',
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-1.5 pl-1 text-left text-[12px] rounded-md hover:text-foreground transition-colors cursor-pointer',
          SIZE.row,
        )}
      >
        <ChevronRight
          className={cn(
            'size-2.5 text-muted-foreground/60 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />

        <StatusIcon status={derivedStatus} toolName={parent.toolName} />

        {subagentType && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-medium leading-none">
            {subagentType}
          </span>
        )}

        <span className="truncate flex-1 min-w-0 text-foreground/80">{displayLabel}</span>

        {parent.elapsedSeconds !== undefined && parent.elapsedSeconds > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
            {formatElapsed(parent.elapsedSeconds)}
          </span>
        )}

        {children.length > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
            {children.filter((c) => c.done).length}/{children.length}
          </span>
        )}
      </button>

      {expanded && children.length > 0 && (
        <div
          className={cn(
            'pl-6 pr-1 space-y-0 border-l-2 border-muted ml-[7px]',
            'animate-in fade-in slide-in-from-top-1 duration-150',
          )}
        >
          {children.map((child, ci) => (
            <React.Fragment key={child.toolUseId}>
              <ActivityRow
                activity={child}
                index={ci}
                animate={animate}
                onOpenDetails={onOpenDetails}
              />
              {detailsId === child.toolUseId && (
                <ActivityDetails activity={child} onClose={onCloseDetails ?? (() => {})} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 工具结果图片 =====

function ToolResultImage({ attachment }: { attachment: { localPath: string; filename: string; mediaType: string } }): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    window.electronAPI
      .readAttachment(attachment.localPath)
      .then((base64) => {
        setImageSrc(`data:${attachment.mediaType};base64,${base64}`)
      })
      .catch((error) => {
        console.error('[ToolResultImage] 读取附件失败:', error)
      })
  }, [attachment.localPath, attachment.mediaType])

  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(attachment.localPath, attachment.filename)
  }, [attachment.localPath, attachment.filename])

  if (!imageSrc) {
    return <div className="size-[120px] rounded-md bg-muted/30 animate-pulse" />
  }

  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={attachment.filename}
        className="max-w-[240px] max-h-[240px] rounded-md object-cover"
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        title="保存图片"
      >
        <Download className="size-3.5" />
      </button>
    </div>
  )
}

// ===== 详情面板（仅显示结果，使用 ToolResultRenderer） =====

function ActivityDetails({ activity, onClose }: { activity: ToolActivity; onClose: () => void }): React.ReactElement {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = (): void => {
    const parts: string[] = [`[${activity.toolName}]`]
    if (activity.result) {
      parts.push(activity.result)
    }
    navigator.clipboard.writeText(parts.join('\n\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mt-1 rounded-md border border-border/40 bg-muted/20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 ease-out">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
        <span className="text-[11px] font-medium text-foreground/50">{getToolPhrase(activity.toolName, activity.input).label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[11px] text-foreground/40 hover:text-foreground transition-colors"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      <div className="px-3 py-2 space-y-2 max-h-[400px] overflow-y-auto">
        {activity.result && (
          <ToolResultRenderer
            toolName={activity.toolName}
            input={activity.input}
            result={activity.result}
            isError={activity.isError ?? false}
          />
        )}
        {activity.imageAttachments && activity.imageAttachments.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-foreground/40 mb-1">生成图片</div>
            <div className="flex flex-wrap gap-2">
              {activity.imageAttachments.map((img, i) => (
                <ToolResultImage key={i} attachment={img} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 中间思考行 =====

function IntermediateRow({ text, index, animate }: { text: string; index: number; animate: boolean }): React.ReactElement {
  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[13px] text-foreground/50',
        SIZE.row,
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <MessageCircleDashed className={cn(SIZE.icon, 'text-muted-foreground/50')} />
      <span className="truncate flex-1">{text}</span>
    </div>
  )
}

// ===== 主导出：活动列表 =====

interface ToolActivityListProps {
  activities: ToolActivity[]
  animate?: boolean
}

export function ToolActivityList({ activities, animate = false }: ToolActivityListProps): React.ReactElement | null {
  const [detailsId, setDetailsId] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)

  const grouped = React.useMemo(() => groupActivities(activities), [activities])

  const visibleRows = React.useMemo(() => {
    let count = 0
    for (const item of grouped) {
      count += 1
      if (isActivityGroup(item)) {
        count += item.children.length
      }
    }
    return count
  }, [grouped])

  const needsCollapse = visibleRows > SIZE.autoScrollThreshold

  // 流式模式：自动滚动到底部
  React.useEffect(() => {
    if (animate && listRef.current && needsCollapse) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [visibleRows, needsCollapse, animate])

  if (activities.length === 0) return null

  const detailActivity = detailsId ? activities.find((a) => a.toolUseId === detailsId) : null

  const handleOpenDetails = (activity: ToolActivity): void => {
    setDetailsId((prev) => (prev === activity.toolUseId ? null : activity.toolUseId))
  }

  // 流式：固定高度 + 自动滚动
  // 已完成未展开：固定高度 + overflow-hidden（无滚动条）
  // 已完成已展开：无高度限制
  const isCollapsed = !animate && needsCollapse && !expanded

  return (
    <div className="w-full">
      <div
        ref={listRef}
        className={cn(
          'space-y-0',
          animate && needsCollapse && 'overflow-y-auto',
          isCollapsed && 'overflow-hidden',
        )}
        style={
          animate && needsCollapse
            ? { maxHeight: SIZE.autoScrollThreshold * SIZE.rowHeight }
            : isCollapsed
              ? { maxHeight: SIZE.autoScrollThreshold * SIZE.rowHeight }
              : undefined
        }
      >
      {grouped.map((item, i) => {
        if (isActivityGroup(item)) {
          return (
            <ActivityGroupRow
              key={item.parent.toolUseId}
              group={item}
              index={i}
              animate={animate}
              onOpenDetails={handleOpenDetails}
              detailsId={detailsId}
              onCloseDetails={() => setDetailsId(null)}
            />
          )
        }

        const activity = item as ToolActivity

        // TodoWrite / TaskCreate 特殊渲染
        if (activity.toolName === 'TodoWrite' || activity.toolName === 'TaskCreate') {
          const todos = parseTodoItems(activity.input)
          if (todos && todos.length > 0) {
            return (
              <React.Fragment key={activity.toolUseId}>
                <ActivityRow
                  activity={activity}
                  index={i}
                  animate={animate}
                  // 不传递 onOpenDetails，TodoWrite/TaskCreate 不支持点击展开详情
                  // 因为它们已经有专属的 TodoList 展示
                />
                <TodoList items={todos} />
              </React.Fragment>
            )
          }
        }

        return (
          <React.Fragment key={activity.toolUseId}>
            <ActivityRow
              activity={activity}
              index={i}
              animate={animate}
              onOpenDetails={handleOpenDetails}
            />
            {detailsId === activity.toolUseId && detailActivity && (
              <ActivityDetails activity={detailActivity} onClose={() => setDetailsId(null)} />
            )}
          </React.Fragment>
        )
      })}
      </div>

      {/* 已完成消息：折叠/展开按钮 */}
      {!animate && needsCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[11px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          {expanded ? '收起工具活动' : `展开全部 ${visibleRows} 项工具活动`}
        </button>
      )}
    </div>
  )
}

// 保留单项导出（向后兼容 AgentMessages 中的旧引用）
export function ToolActivityItem({ activity }: { activity: ToolActivity }): React.ReactElement {
  return <ToolActivityList activities={[activity]} />
}

// 导出格式化耗时（供外部组件引用）
export { formatElapsed }
