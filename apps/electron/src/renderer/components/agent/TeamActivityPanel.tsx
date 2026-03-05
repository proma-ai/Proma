/**
 * TeamActivityPanel — Agent Teams 活动面板
 *
 * 展示团队全景：Team 头部 + Task Board + Agent 卡片列表 + 通信时间线。
 * 从 toolActivities 中提取 TeamCreate/TaskCreate/Agent 工具调用的丰富数据。
 * 通过轮询 getAgentTeamData 读取 Agent 间 inbox 通信消息。
 */

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  teamOverviewAtom,
  teammateStatesAtom,
  hasTeammatesAtom,
  agentSessionsAtom,
  agentStreamingStatesAtom,
  dismissedTeamSessionIdsAtom,
  cachedPolledTeamDataAtom,
  type TeamOverview,
  type TeamTaskItem,
  type TeamAgentInfo,
  type TeammateState,
  type ActivityStatus,
} from '@/atoms/agent-atoms'
import { formatElapsed } from './ToolActivityItem'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ParsedMailboxMessage, AgentTeamData, TaskItem } from '@proma/shared'
import {
  Users,
  Loader2,
  CheckCircle2,
  XCircle,
  StopCircle,
  ChevronDown,
  Clock,
  Wrench,
  Zap,
  FileText,
  Bot,
  ListChecks,
  ArrowRight,
  Circle,
  Lock,
  MessageSquare,
  Send,
  X,
} from 'lucide-react'

interface TeamActivityPanelProps {
  sessionId: string
}

export function TeamActivityPanel({ sessionId }: TeamActivityPanelProps): React.ReactElement {
  const overview = useAtomValue(teamOverviewAtom)
  const teammates = useAtomValue(teammateStatesAtom)
  const hasTeammates = useAtomValue(hasTeammatesAtom)
  const setDismissed = useSetAtom(dismissedTeamSessionIdsAtom)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 关闭 Team 面板
  const handleDismiss = useCallback(() => {
    setDismissed((prev: Set<string>) => new Set([...prev, sessionId]))
    toast.success('Team 活动面板已关闭', {
      description: '发送新消息时会自动恢复显示',
    })
  }, [sessionId, setDismissed])

  // 基础 agent 列表（来自 tool events）
  const rawAgentEntries = overview?.agents ?? []

  // 轮询文件系统数据（task 状态 + inbox 通信消息）
  const sessions = useAtomValue(agentSessionsAtom)
  const session = sessions.find((s) => s.id === sessionId)
  const sdkSessionId = session?.sdkSessionId
  const streamState = useAtomValue(agentStreamingStatesAtom).get(sessionId)
  const isStreaming = streamState?.running ?? false
  const store = useStore()
  const cachedPolled = useAtomValue(cachedPolledTeamDataAtom).get(sessionId)
  const [polledData, setPolledDataLocal] = useState<AgentTeamData | null>(cachedPolled ?? null)

  // 更新 polledData 同时写入缓存（防止组件卸载后数据丢失）
  const setPolledData = useCallback((data: AgentTeamData) => {
    setPolledDataLocal(data)
    store.set(cachedPolledTeamDataAtom, (prev) => {
      const map = new Map(prev)
      map.set(sessionId, data)
      return map
    })
  }, [sessionId, store])

  useEffect(() => {
    if (!sdkSessionId || !hasTeammates) return
    const poll = async (): Promise<void> => {
      try {
        const data = await window.electronAPI.getAgentTeamData(sdkSessionId)
        if (data) setPolledData(data)
      } catch {
        // 轮询错误不影响 UI
      }
    }
    poll()
    if (!isStreaming) return
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [sdkSessionId, hasTeammates, isStreaming, setPolledData])

  // 用文件系统的真实 task 状态合并 overview tasks
  const mergedTasks = useMemo(() => {
    if (!overview?.tasks.length) return overview?.tasks ?? []
    if (!polledData?.tasks.length) return overview.tasks
    return overview.tasks.map((t) => {
      const polledTask = polledData.tasks.find((pt) =>
        pt.subject === t.subject || (t.taskNumber && pt.id === t.taskNumber),
      )
      if (!polledTask) return t
      return { ...t, status: polledTask.status }
    })
  }, [overview?.tasks, polledData?.tasks])

  // 用文件系统 task 状态推算 agent 完成情况
  const agentEntries = useMemo(() => {
    if (!rawAgentEntries.length || !polledData?.tasks.length) return rawAgentEntries
    return rawAgentEntries.map((agent) => {
      // 已确认完成的保持不变；stopped/failed 允许被 polled data 修正为 completed
      if (agent.teammate && agent.teammate.status === 'completed') return agent
      // 按 owner 名称匹配文件系统 task
      const ownedTask = polledData.tasks.find((pt) => pt.owner === agent.name)
      if (ownedTask?.status === 'completed') {
        const updatedTm: TeammateState = agent.teammate
          ? { ...agent.teammate, status: 'completed', endedAt: agent.teammate.endedAt ?? Date.now() }
          : {
              taskId: `polled-${agent.toolUseId}`,
              description: agent.description,
              index: 0,
              status: 'completed',
              toolHistory: [],
              startedAt: Date.now(),
              endedAt: Date.now(),
            }
        return { ...agent, teammate: updatedTm, status: 'completed' as ActivityStatus }
      }
      return agent
    })
  }, [rawAgentEntries, polledData?.tasks])

  // 空状态
  if (!overview && !hasTeammates) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2.5 text-muted-foreground/60">
          <Bot className="size-8" />
          <p className="text-xs">暂无 Team 活动</p>
          <p className="text-[11px]">发送复杂任务时 Agent 会自动创建 teammates</p>
        </div>
      </div>
    )
  }

  const hasAgents = agentEntries.length > 0
  const displayTeammates = hasAgents ? [] : teammates

  const runningCount = hasAgents
    ? agentEntries.filter((a) => a.teammate?.status === 'running' || a.status === 'running').length
    : teammates.filter((t) => t.status === 'running').length
  const doneCount = hasAgents
    ? agentEntries.filter((a) => {
        const s = a.teammate?.status ?? (a.status === 'completed' || a.status === 'error' ? a.status : undefined)
        return s === 'completed' || s === 'stopped' || s === 'failed' || s === 'error'
      }).length
    : teammates.filter((t) => t.status !== 'running').length
  const totalCount = hasAgents ? agentEntries.length : teammates.length

  return (
    <div className="flex h-full flex-col">
      {/* Team 头部 */}
      {overview?.teamName && (
        <div className="border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Users className="size-3.5 text-primary" />
            <span className="text-xs font-semibold">{overview.teamName}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="ml-auto rounded-md p-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-foreground/[0.05] transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">关闭 Team 面板</TooltipContent>
            </Tooltip>
          </div>
          {overview.teamDescription && (
            <p className="mt-1 text-[11px] text-muted-foreground/70 leading-relaxed">
              {overview.teamDescription}
            </p>
          )}
        </div>
      )}

      {/* 摘要栏 */}
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">{totalCount} 个 Agent</span>
        <div className="ml-auto flex items-center gap-1.5">
          {runningCount > 0 && (
            <Badge variant="secondary" className="h-4.5 gap-1 rounded-full px-1.5 text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Loader2 className="size-2 animate-spin" />
              {runningCount}
            </Badge>
          )}
          {doneCount > 0 && (
            <Badge variant="secondary" className="h-4.5 gap-1 rounded-full px-1.5 text-[10px] bg-green-500/10 text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-2" />
              {doneCount}
            </Badge>
          )}
          {/* 无 Team 头部时在摘要栏显示关闭按钮 */}
          {!overview?.teamName && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="rounded-md p-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-foreground/[0.05] transition-colors"
                >
                  <X className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">关闭 Team 面板</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-2">
          {/* Task Board */}
          {mergedTasks.length > 0 && (
            <TaskBoard tasks={mergedTasks} />
          )}

          {/* Agent 卡片（有 overview 时） */}
          {hasAgents && agentEntries.map((agent) => (
            <AgentCard
              key={agent.toolUseId}
              agent={agent}
              expanded={expandedId === agent.toolUseId}
              onToggle={() => setExpandedId(expandedId === agent.toolUseId ? null : agent.toolUseId)}
            />
          ))}

          {/* 回退：TeammateState 卡片（无 overview 时） */}
          {!hasAgents && displayTeammates.map((tm) => (
            <TeammateCard
              key={tm.taskId}
              teammate={tm}
              expanded={expandedId === tm.taskId}
              onToggle={() => setExpandedId(expandedId === tm.taskId ? null : tm.taskId)}
            />
          ))}

          {/* Agent 通信时间线 */}
          <MailboxTimeline inboxes={polledData?.inboxes ?? {}} />
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// TaskBoard — 任务看板
// ============================================================================

function TaskBoard({ tasks }: { tasks: TeamTaskItem[] }): React.ReactElement {
  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0

  return (
    <div className="rounded-lg bg-foreground/[0.03] dark:bg-foreground/[0.05] px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <ListChecks className="size-3 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground">Task Board</span>
        <span className="text-[10px] text-muted-foreground/50 ml-auto">
          {completedCount}/{tasks.length}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-1 rounded-full bg-foreground/[0.06] dark:bg-foreground/[0.1] mb-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500/60 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* 任务列表 */}
      <div className="flex flex-col gap-1">
        {tasks.map((task) => (
          <TaskRow key={task.toolUseId} task={task} />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: TeamTaskItem }): React.ReactElement {
  const isCompleted = task.status === 'completed'
  const isBlocked = task.blockedBy.length > 0 && !isCompleted

  return (
    <div className="flex items-start gap-1.5 py-0.5">
      {/* 状态图标 */}
      {isCompleted ? (
        <CheckCircle2 className="size-3 text-green-500 mt-0.5 shrink-0" />
      ) : isBlocked ? (
        <Lock className="size-3 text-yellow-500/70 mt-0.5 shrink-0" />
      ) : task.status === 'in_progress' ? (
        <Loader2 className="size-3 text-blue-500 animate-spin mt-0.5 shrink-0" />
      ) : (
        <Circle className="size-3 text-muted-foreground/30 mt-0.5 shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {task.taskNumber && (
            <span className="text-[10px] font-mono text-muted-foreground/50">#{task.taskNumber}</span>
          )}
          <span className={cn(
            'text-[11px] truncate',
            isCompleted && 'line-through text-muted-foreground/50',
          )}>
            {task.subject}
          </span>
        </div>
        {isBlocked && (
          <span className="text-[9px] text-yellow-600/60 dark:text-yellow-400/60">
            等待 #{task.blockedBy.join(', #')}
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// MailboxTimeline — Agent 间通信消息时间线
// ============================================================================

/** 系统消息类型（过滤但计数） */
const SYSTEM_MESSAGE_TYPES = new Set(['idle_notification', 'shutdown_request', 'shutdown_approved'])

/** 带接收者信息的消息 */
interface TimelineMessage extends ParsedMailboxMessage {
  recipient: string
}

function MailboxTimeline({ inboxes }: { inboxes: Record<string, ParsedMailboxMessage[]> }): React.ReactElement | null {
  const [collapsed, setCollapsed] = useState(false)

  // 合并所有 inbox 消息，附加接收者名称，按时间排序
  const { messages, systemCount } = useMemo(() => {
    const all: TimelineMessage[] = []
    let sysCount = 0

    for (const [recipient, msgs] of Object.entries(inboxes)) {
      for (const msg of msgs) {
        if (SYSTEM_MESSAGE_TYPES.has(msg.parsedType)) {
          sysCount++
          continue
        }
        all.push({ ...msg, recipient })
      }
    }

    // 按时间排序
    all.sort((a, b) => {
      if (a.timestamp && b.timestamp) return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      if (a.timestamp) return -1
      if (b.timestamp) return 1
      return 0
    })

    return { messages: all, systemCount: sysCount }
  }, [inboxes])

  // 无消息时不显示
  if (messages.length === 0 && systemCount === 0) return null

  return (
    <div className="rounded-lg bg-foreground/[0.03] dark:bg-foreground/[0.05] px-3 py-2.5">
      {/* 折叠头部 */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2"
      >
        <MessageSquare className="size-3 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground">Agent 通信</span>
        <span className="text-[10px] text-muted-foreground/50 ml-auto">
          {messages.length} 条消息
          {systemCount > 0 && (
            <span className="text-muted-foreground/40"> · {systemCount} 系统</span>
          )}
        </span>
        <ChevronDown className={cn(
          'size-3 text-muted-foreground/40 transition-transform duration-200',
          collapsed && '-rotate-90',
        )} />
      </button>

      {/* 消息列表 */}
      {!collapsed && messages.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {messages.map((msg, i) => (
            <MailboxMessageRow key={i} message={msg} />
          ))}
        </div>
      )}
    </div>
  )
}

function MailboxMessageRow({ message }: { message: TimelineMessage }): React.ReactElement {
  const isTaskAssignment = message.parsedType === 'task_assignment'

  // 提取可读内容
  let displayText = message.summary ?? message.text
  try {
    const parsed = JSON.parse(message.text) as Record<string, unknown>
    if (typeof parsed.content === 'string') displayText = parsed.content
  } catch {
    // 非 JSON，使用原文
  }

  return (
    <div className="flex items-start gap-2 rounded-md bg-foreground/[0.02] dark:bg-foreground/[0.04] px-2.5 py-2">
      {/* 消息类型图标 */}
      {isTaskAssignment ? (
        <Send className="size-3 text-blue-500 mt-0.5 shrink-0" />
      ) : (
        <MessageSquare className="size-3 text-muted-foreground/50 mt-0.5 shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        {/* 发送者 → 接收者 */}
        <div className="flex items-center gap-1 mb-0.5">
          <span className={cn(
            'text-[10px] font-medium',
            isTaskAssignment ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground/70',
          )}>
            {message.from}
          </span>
          <ArrowRight className="size-2 text-muted-foreground/30" />
          <span className="text-[10px] text-muted-foreground/50">{message.recipient}</span>
          {message.timestamp && (
            <span className="ml-auto text-[9px] text-muted-foreground/40">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>

        {/* 消息内容 */}
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-3 break-all">
          {displayText}
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// AgentCard — Agent 信息 + TeammateState 实时数据
// ============================================================================

interface AgentCardProps {
  agent: TeamAgentInfo
  expanded: boolean
  onToggle: () => void
}

function AgentCard({ agent, expanded, onToggle }: AgentCardProps): React.ReactElement {
  const tm = agent.teammate
  const isRunning = tm?.status === 'running' || (!tm && agent.status === 'running')
  const elapsed = useTeammateElapsed(tm ?? null)

  return (
    <div className={cn(
      'rounded-lg transition-colors',
      'bg-foreground/[0.03] dark:bg-foreground/[0.05]',
      expanded && 'bg-foreground/[0.05] dark:bg-foreground/[0.07]',
    )}>
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-foreground/[0.02] dark:hover:bg-foreground/[0.03] rounded-lg transition-colors"
      >
        {/* 头部：名称 + 类型 + 状态 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{agent.name}</span>
          {agent.subagentType && agent.subagentType !== 'general-purpose' && (
            <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[9px] text-muted-foreground/60">
              {agent.subagentType}
            </Badge>
          )}
          {agent.isBackground && (
            <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[9px] text-muted-foreground/60">
              后台
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <TeammateStatusBadge status={tm?.status} activityStatus={agent.status} />
            <ChevronDown className={cn(
              'size-3 text-muted-foreground/40 transition-transform duration-200',
              expanded && 'rotate-180',
            )} />
          </div>
        </div>

        {/* 任务描述 */}
        <p className={cn('text-[11px] text-muted-foreground/70 leading-relaxed', !expanded && 'line-clamp-2')}>
          {agent.description}
        </p>

        {/* 运行中：当前工具 + 进度描述 + 工具链 */}
        {isRunning && tm && (
          <div className="flex flex-col gap-1.5">
            {/* 当前工具（高亮卡片） */}
            {tm.currentToolName && (
              <div className="flex items-center gap-1.5 rounded-md bg-blue-500/5 dark:bg-blue-500/10 px-2 py-1">
                <Wrench className="size-2.5 text-blue-500 animate-pulse" />
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-mono truncate flex-1">
                  {tm.currentToolName}
                </span>
                {tm.currentToolElapsedSeconds != null && tm.currentToolElapsedSeconds > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground/50">
                    {formatElapsed(tm.currentToolElapsedSeconds)}
                  </span>
                )}
              </div>
            )}
            {/* 进度描述（2 行） */}
            {tm.progressDescription && (
              <p className="text-[11px] text-muted-foreground/60 italic leading-relaxed line-clamp-2">
                {tm.progressDescription}
              </p>
            )}
            {/* 工具链（最近 5 个工具） */}
            {tm.toolHistory.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {tm.toolHistory.slice(-5).map((tool, i, arr) => (
                  <Fragment key={`${tool}-${i}`}>
                    <span className="text-[10px] font-mono text-muted-foreground/50 bg-foreground/[0.04] dark:bg-foreground/[0.06] rounded px-1 py-0.5">
                      {tool}
                    </span>
                    {i < arr.length - 1 && (
                      <span className="text-[9px] text-muted-foreground/30">→</span>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 已完成：摘要 */}
        {!expanded && tm?.status === 'completed' && tm.summary && (
          <p className="text-[11px] text-green-700/70 dark:text-green-400/70 line-clamp-2">
            {tm.summary}
          </p>
        )}

        {/* 底部统计 */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          {elapsed && (
            <span className="flex items-center gap-1">
              <Clock className="size-2.5" />
              {elapsed}
            </span>
          )}
          {tm?.usage && (
            <>
              <span className="flex items-center gap-1">
                <Wrench className="size-2.5" />
                {tm.usage.toolUses}
              </span>
              <span className="flex items-center gap-1">
                <Zap className="size-2.5" />
                {formatTokens(tm.usage.totalTokens)}
              </span>
            </>
          )}
          {tm && tm.toolHistory.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground/40">
              {tm.toolHistory.length} 个工具
            </span>
          )}
        </div>
      </button>

      {/* 展开详情 */}
      {expanded && <AgentDetail agent={agent} />}
    </div>
  )
}

function AgentDetail({ agent }: { agent: TeamAgentInfo }): React.ReactElement {
  const tm = agent.teammate
  const hasSummary = !!tm?.summary
  const hasProgress = tm?.status === 'running' && !!tm.progressDescription
  const hasToolHistory = tm && tm.toolHistory.length > 0
  const hasOutput = !!tm?.outputFile
  const hasUsage = !!tm?.usage
  const hasAnyContent = hasSummary || hasProgress || hasToolHistory || hasOutput || hasUsage

  return (
    <div className="flex flex-col gap-2.5 px-3 pb-3">
      <Separator />

      {/* 工作摘要 */}
      {hasSummary && (
        <DetailSection title="工作摘要" borderColor="border-l-green-500">
          <MarkdownContent content={tm!.summary!} />
        </DetailSection>
      )}

      {/* 当前进度（运行中） */}
      {hasProgress && (
        <DetailSection title="当前进度" borderColor="border-l-blue-500">
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            {tm!.progressDescription}
          </p>
        </DetailSection>
      )}

      {/* 使用量统计 */}
      {hasUsage && (
        <DetailSection title="使用量" borderColor="border-l-violet-500">
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground/70">
            <span className="flex items-center gap-1">
              <Wrench className="size-2.5" />
              {tm!.usage!.toolUses} 次工具调用
            </span>
            <span className="flex items-center gap-1">
              <Zap className="size-2.5" />
              {formatTokens(tm!.usage!.totalTokens)} tokens
            </span>
            {tm!.usage!.durationMs > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="size-2.5" />
                {formatElapsed(tm!.usage!.durationMs / 1000)}
              </span>
            )}
          </div>
        </DetailSection>
      )}

      {/* 工具使用历史 */}
      {hasToolHistory && (
        <ToolHistorySection toolHistory={tm!.toolHistory} />
      )}

      {/* 产出文件 */}
      {hasOutput && (
        <OutputFileSection filePath={tm!.outputFile!} />
      )}

      {/* 无详细数据时的提示 */}
      {!hasAnyContent && (
        <p className="text-[11px] text-muted-foreground/40 text-center py-2">
          {tm?.status === 'running'
            ? '等待 Agent 返回进度数据...'
            : agent.status === 'running'
              ? 'Agent 正在初始化...'
              : '暂无详细数据'}
        </p>
      )}
    </div>
  )
}

// ============================================================================
// TeammateCard — 回退方案（无 overview 时使用）
// ============================================================================

interface TeammateCardProps {
  teammate: TeammateState
  expanded: boolean
  onToggle: () => void
}

function TeammateCard({ teammate, expanded, onToggle }: TeammateCardProps): React.ReactElement {
  const isRunning = teammate.status === 'running'
  const elapsed = useTeammateElapsed(teammate)

  return (
    <div className={cn(
      'rounded-lg transition-colors',
      'bg-foreground/[0.03] dark:bg-foreground/[0.05]',
      expanded && 'bg-foreground/[0.05] dark:bg-foreground/[0.07]',
    )}>
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-foreground/[0.02] dark:hover:bg-foreground/[0.03] rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-muted-foreground/70">#{teammate.index}</span>
          <TeammateStatusBadge status={teammate.status} />
          <ChevronDown className={cn(
            'ml-auto size-3 text-muted-foreground/40 transition-transform duration-200',
            expanded && 'rotate-180',
          )} />
        </div>

        <p className={cn('text-xs leading-relaxed', !expanded && 'line-clamp-2')}>{teammate.description}</p>

        {isRunning && (
          <div className="flex flex-col gap-1.5">
            {teammate.currentToolName && (
              <div className="flex items-center gap-1.5 rounded-md bg-blue-500/5 dark:bg-blue-500/10 px-2 py-1">
                <Wrench className="size-2.5 text-blue-500 animate-pulse" />
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-mono truncate flex-1">
                  {teammate.currentToolName}
                </span>
                {teammate.currentToolElapsedSeconds != null && teammate.currentToolElapsedSeconds > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground/50">
                    {formatElapsed(teammate.currentToolElapsedSeconds)}
                  </span>
                )}
              </div>
            )}
            {teammate.progressDescription && (
              <p className="text-[11px] text-muted-foreground/60 italic leading-relaxed line-clamp-2">
                {teammate.progressDescription}
              </p>
            )}
            {teammate.toolHistory.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {teammate.toolHistory.slice(-5).map((tool, i, arr) => (
                  <Fragment key={`${tool}-${i}`}>
                    <span className="text-[10px] font-mono text-muted-foreground/50 bg-foreground/[0.04] dark:bg-foreground/[0.06] rounded px-1 py-0.5">
                      {tool}
                    </span>
                    {i < arr.length - 1 && (
                      <span className="text-[9px] text-muted-foreground/30">→</span>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        )}

        {!expanded && teammate.status === 'completed' && teammate.summary && (
          <p className="text-[11px] text-green-700/70 dark:text-green-400/70 line-clamp-2">
            {teammate.summary}
          </p>
        )}

        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          {elapsed && (
            <span className="flex items-center gap-1">
              <Clock className="size-2.5" />
              {elapsed}
            </span>
          )}
          {teammate.usage && (
            <>
              <span className="flex items-center gap-1">
                <Wrench className="size-2.5" />
                {teammate.usage.toolUses}
              </span>
              <span className="flex items-center gap-1">
                <Zap className="size-2.5" />
                {formatTokens(teammate.usage.totalTokens)}
              </span>
            </>
          )}
        </div>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <Separator />
          {teammate.summary && (
            <DetailSection title="工作摘要" borderColor="border-l-green-500">
              <MarkdownContent content={teammate.summary} />
            </DetailSection>
          )}
          {teammate.status === 'running' && teammate.progressDescription && (
            <DetailSection title="当前进度" borderColor="border-l-blue-500">
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                {teammate.progressDescription}
              </p>
            </DetailSection>
          )}
          {teammate.usage && (
            <DetailSection title="使用量" borderColor="border-l-violet-500">
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground/70">
                <span className="flex items-center gap-1">
                  <Wrench className="size-2.5" />
                  {teammate.usage.toolUses} 次工具调用
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="size-2.5" />
                  {formatTokens(teammate.usage.totalTokens)} tokens
                </span>
                {teammate.usage.durationMs > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="size-2.5" />
                    {formatElapsed(teammate.usage.durationMs / 1000)}
                  </span>
                )}
              </div>
            </DetailSection>
          )}
          {teammate.toolHistory.length > 0 && (
            <ToolHistorySection toolHistory={teammate.toolHistory} />
          )}
          {teammate.outputFile && (
            <OutputFileSection filePath={teammate.outputFile} />
          )}
          {!teammate.summary && !teammate.usage && teammate.toolHistory.length === 0 && !teammate.outputFile && (
            <p className="text-[11px] text-muted-foreground/40 text-center py-2">
              {teammate.status === 'running' ? '等待 Agent 返回进度数据...' : '暂无详细数据'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 共享子组件
// ============================================================================

function TeammateStatusBadge({
  status,
  activityStatus,
}: {
  status?: TeammateState['status']
  activityStatus?: string
}): React.ReactElement {
  const s = status ?? (activityStatus === 'completed' ? 'completed' : activityStatus === 'error' ? 'failed' : 'running')
  switch (s) {
    case 'running':
      return (
        <Badge variant="secondary" className="h-4 gap-1 rounded-full px-1.5 text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Loader2 className="size-2 animate-spin" />
          运行中
        </Badge>
      )
    case 'completed':
      return (
        <Badge variant="secondary" className="h-4 gap-1 rounded-full px-1.5 text-[10px] bg-green-500/10 text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-2" />
          已完成
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="secondary" className="h-4 gap-1 rounded-full px-1.5 text-[10px] bg-red-500/10 text-red-600 dark:text-red-400">
          <XCircle className="size-2" />
          失败
        </Badge>
      )
    case 'stopped':
      return (
        <Badge variant="secondary" className="h-4 gap-1 rounded-full px-1.5 text-[10px] bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <StopCircle className="size-2" />
          已停止
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary" className="h-4 gap-1 rounded-full px-1.5 text-[10px] bg-muted text-muted-foreground/60">
          <Circle className="size-2" />
          等待中
        </Badge>
      )
  }
}

function DetailSection({
  title,
  borderColor,
  children,
}: {
  title: string
  borderColor?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className={cn('rounded-md border-l-2 bg-foreground/[0.02] dark:bg-foreground/[0.04] px-3 py-2', borderColor)}>
      <p className="text-[10px] font-medium text-muted-foreground/60 mb-1.5">{title}</p>
      {children}
    </div>
  )
}

function ToolHistorySection({ toolHistory }: { toolHistory: string[] }): React.ReactElement {
  const counts = new Map<string, number>()
  for (const tool of toolHistory) {
    counts.set(tool, (counts.get(tool) ?? 0) + 1)
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])

  return (
    <DetailSection title="工具使用" borderColor="border-l-muted-foreground/30">
      <div className="flex flex-wrap gap-1 mb-2">
        {sorted.map(([tool, count]) => (
          <Badge
            key={tool}
            variant="secondary"
            className="h-4 gap-0.5 rounded-full px-1.5 text-[10px] bg-foreground/[0.04] dark:bg-foreground/[0.06]"
          >
            {tool}
            {count > 1 && <span className="text-muted-foreground/50">×{count}</span>}
          </Badge>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/40 font-mono leading-relaxed break-all">
        {toolHistory.join(' → ')}
      </p>
    </DetailSection>
  )
}

function OutputFileSection({ filePath }: { filePath: string }): React.ReactElement {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.electronAPI
      .getAgentOutput(filePath)
      .then((text) => setContent(text))
      .catch(() => setContent(null))
      .finally(() => setLoading(false))
  }, [filePath])

  return (
    <DetailSection title="产出文件" borderColor="border-l-amber-500">
      <div className="flex items-center gap-1.5 mb-1.5">
        <FileText className="size-2.5 text-muted-foreground/50" />
        <span className="text-[10px] font-mono text-muted-foreground/50 truncate">{filePath}</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
          <Loader2 className="size-2.5 animate-spin" />
          加载中...
        </div>
      ) : content ? (
        <div className="max-h-[200px] overflow-auto rounded bg-foreground/[0.02] dark:bg-foreground/[0.04] p-2">
          <MarkdownContent content={content} />
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground/40">无法读取文件内容</p>
      )}
    </DetailSection>
  )
}

function MarkdownContent({ content }: { content: string }): React.ReactElement {
  return (
    <div className="prose dark:prose-invert max-w-none text-[11px] prose-p:my-0.5 prose-li:leading-relaxed prose-pre:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** 实时耗时 — 支持 TeammateState 或 null */
function useTeammateElapsed(teammate: TeammateState | null): string | null {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!teammate || teammate.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [teammate?.status])

  if (!teammate) return null
  const endTime = teammate.endedAt ?? now
  const durationMs = endTime - teammate.startedAt
  const seconds = Math.max(0, durationMs / 1000)
  return formatElapsed(seconds)
}
