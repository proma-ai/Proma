/**
 * ToolActivityItem — 紧凑列表式工具活动展示
 *
 * 对标 craft-agents-oss TurnCard 的 ActivityRow 设计：
 * - 单行紧凑布局（24px 行高）
 * - 工具类型图标 + 语义状态切换
 * - Badge 系统（文件名 / diff 统计 / 错误）
 * - Task 子代理折叠分组 + 左边框层级
 * - CSS 动画（交错入场 / 状态切换）
 */

import * as React from 'react'
import {
  Pencil,
  FilePenLine,
  FileText,
  Terminal,
  FolderSearch,
  Search,
  GitBranch,
  Globe,
  BookOpen,
  Zap,
  ListTodo,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ChevronRight,
  ArrowUpRight,
  MessageCircleDashed,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
  icon: 'size-3',
  spinner: 'size-2.5',
  row: 'py-[3px]',
  staggerLimit: 10,
  autoScrollThreshold: 6,
  rowHeight: 24,
} as const

// ===== 工具图标映射 =====

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Edit: Pencil,
  Write: FilePenLine,
  Read: FileText,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  Task: GitBranch,
  WebFetch: Globe,
  WebSearch: Globe,
  NotebookEdit: BookOpen,
  Skill: Zap,
  TodoWrite: ListTodo,
  TodoRead: ListTodo,
  TaskCreate: ListTodo,
  TaskUpdate: ListTodo,
  TaskGet: ListTodo,
  TaskList: ListTodo,
}

function getToolIcon(toolName: string): React.ComponentType<{ className?: string }> {
  return TOOL_ICONS[toolName] ?? Wrench
}

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

// ===== Diff 统计 =====

interface DiffStats {
  additions: number
  deletions: number
}

function computeDiffStats(toolName: string, input: Record<string, unknown>): DiffStats | null {
  if (toolName === 'Edit') {
    const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
    const newStr = typeof input.new_string === 'string' ? input.new_string : ''
    if (!oldStr && !newStr) return null
    const oldLines = oldStr.split('\n').length
    const newLines = newStr.split('\n').length
    return { additions: Math.max(0, newLines - oldLines + 1), deletions: Math.max(0, oldLines - newLines + 1) }
  }
  return null
}

// ===== Badge 组件 =====

function FileBadge({ path }: { path: string }): React.ReactElement {
  const filename = path.split('/').pop() ?? path
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-background shadow-sm text-foreground/70 leading-none">
      {filename}
    </span>
  )
}

function DiffBadges({ stats }: { stats: DiffStats }): React.ReactElement {
  return (
    <span className="shrink-0 flex items-center gap-1">
      {stats.deletions > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-destructive/5 text-destructive leading-none shadow-sm">
          -{stats.deletions}
        </span>
      )}
      {stats.additions > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/5 text-green-600 dark:text-green-400 leading-none shadow-sm">
          +{stats.additions}
        </span>
      )}
    </span>
  )
}

function ErrorBadge(): React.ReactElement {
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-destructive/5 text-destructive font-medium leading-none shadow-sm">
      Error
    </span>
  )
}

// ===== 格式化耗时 =====

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m${s}s`
}

// ===== 提取文件路径 =====

function extractFilePath(input: Record<string, unknown>): string | null {
  const fp = input.file_path ?? input.filePath ?? input.path ?? input.notebook_path
  return typeof fp === 'string' ? fp : null
}

// ===== 格式化输入摘要（单行） =====

function getInputSummary(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === 'Bash') {
    const cmd = input.command
    if (typeof cmd === 'string') return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd
  }
  if (toolName === 'Grep') {
    const pattern = input.pattern
    if (typeof pattern === 'string') return `/${pattern}/`
  }
  if (toolName === 'Glob') {
    const pattern = input.pattern
    if (typeof pattern === 'string') return pattern
  }
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    const url = input.url ?? input.query
    if (typeof url === 'string') return url.length > 60 ? url.slice(0, 60) + '…' : url
  }
  if (toolName === 'Skill') {
    const skill = input.skill
    if (typeof skill === 'string') return skill
  }
  return null
}

// ===== 格式化 Input JSON =====

function formatInput(input: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith('_')) filtered[key] = value
  }
  try { return JSON.stringify(filtered, null, 2) } catch { return '[不可序列化]' }
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

interface ActivityRowProps {
  activity: ToolActivity
  index?: number
  animate?: boolean
  onOpenDetails?: (activity: ToolActivity) => void
}

function ActivityRow({ activity, index = 0, animate = false, onOpenDetails }: ActivityRowProps): React.ReactElement {
  const status = getActivityStatus(activity)
  const filePath = extractFilePath(activity.input)
  const diffStats = computeDiffStats(activity.toolName, activity.input)
  const inputSummary = getInputSummary(activity.toolName, activity.input)
  const intent = activity.intent ?? activity.displayName

  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'

  return (
    <div
      className={cn(
        'group/row flex items-center gap-2 text-[13px] rounded-md',
        SIZE.row,
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <StatusIcon status={status} toolName={activity.toolName} />

      <span className="shrink-0 text-foreground/80">{activity.toolName}</span>

      {diffStats && <DiffBadges stats={diffStats} />}

      {filePath && <FileBadge path={filePath} />}

      {activity.isError && <ErrorBadge />}

      <span className="truncate flex-1 min-w-0 text-foreground/50">
        {intent && <>{intent}</>}
        {!intent && inputSummary && <>{inputSummary}</>}
        {intent && inputSummary && <> · <span className="opacity-70">{inputSummary}</span></>}
      </span>

      {activity.elapsedSeconds !== undefined && activity.elapsedSeconds > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
          {formatElapsed(activity.elapsedSeconds)}
        </span>
      )}

      {onOpenDetails && activity.done && (activity.result || Object.keys(activity.input).length > 0) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenDetails(activity) }}
          className="shrink-0 p-0.5 rounded opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-muted/80"
        >
          <ArrowUpRight className="size-3 text-muted-foreground" />
        </button>
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
  const [expanded, setExpanded] = React.useState(true)
  const { parent, children } = group

  const derivedStatus = React.useMemo((): ActivityStatus => {
    const selfStatus = getActivityStatus(parent)
    if (selfStatus === 'completed' || selfStatus === 'error') return selfStatus
    if (children.length > 0 && children.every((c) => c.done)) {
      if (children.some((c) => c.isError)) return 'error'
      if (parent.done) return 'completed'
    }
    return selfStatus
  }, [parent, children])

  const subagentType = typeof parent.input.subagent_type === 'string'
    ? parent.input.subagent_type
    : undefined

  const description = typeof parent.input.description === 'string'
    ? parent.input.description
    : parent.intent ?? parent.displayName ?? 'Task'

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
          'w-full flex items-center gap-2 pl-1 text-left text-[13px] rounded-md hover:text-foreground transition-colors cursor-pointer',
          SIZE.row,
        )}
      >
        <ChevronRight
          className={cn(
            'size-3 text-muted-foreground/60 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />

        <StatusIcon status={derivedStatus} toolName="Task" />

        <span className="shrink-0 px-1.5 py-0.5 rounded bg-background shadow-sm text-[10px] font-medium leading-none">
          {subagentType ?? 'Task'}
        </span>

        <span className="truncate flex-1 min-w-0 text-foreground/70">{description}</span>

        {parent.elapsedSeconds !== undefined && parent.elapsedSeconds > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
            {formatElapsed(parent.elapsedSeconds)}
          </span>
        )}

        {children.length > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground/40 tabular-nums">
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

// ===== 详情面板 =====

function ActivityDetails({ activity, onClose }: { activity: ToolActivity; onClose: () => void }): React.ReactElement {
  return (
    <div className="mt-1 rounded-md border border-border/40 bg-muted/20 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
        <span className="text-[11px] font-medium text-foreground/50">{activity.toolName}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-foreground/40 hover:text-foreground transition-colors"
        >
          收起
        </button>
      </div>

      <div className="px-3 py-2 space-y-2 max-h-[300px] overflow-y-auto">
        {Object.keys(activity.input).length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-foreground/40 mb-1">输入</div>
            <pre className="text-[11px] text-foreground/60 bg-background/50 rounded p-2 overflow-x-auto max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all">
              {formatInput(activity.input)}
            </pre>
          </div>
        )}
        {activity.result && (
          <div>
            <div className="text-[10px] font-medium text-foreground/40 mb-1">结果</div>
            <pre
              className={cn(
                'text-[11px] rounded p-2 overflow-x-auto max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all',
                activity.isError ? 'text-destructive/80 bg-destructive/5' : 'text-foreground/60 bg-background/50',
              )}
            >
              {activity.result.length > 2000 ? activity.result.slice(0, 2000) + '\n… [截断]' : activity.result}
            </pre>
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
                  onOpenDetails={handleOpenDetails}
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
