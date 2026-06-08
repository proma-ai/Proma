/**
 * 定时任务列表视图（codex Automations 风格）
 *
 * 由侧边栏 Automations 入口触发显示，全屏占据中间内容区（隐藏 TabBar）。
 *
 * 结构：
 * - 顶部：标题 "定时任务" + 「+ 新建」按钮
 * - 内容：分组列表
 *   - Current（启用中）：active=true
 *   - Paused（已暂停 / 草稿）：active=false
 * - 每行：名称 + prompt 摘要 + 调度文案
 * - 点击行 → 通过 automationFormAtom 打开编辑表单 overlay
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Clock, Pause, Play, Power, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  automationsAtom,
  automationFormAtom,
  automationToDraft,
  createEmptyDraft,
} from '@/atoms/automation-atoms'
import type { Automation } from '@proma/shared'

/** 把调度配置格式化为可读文案 */
function formatSchedule(a: Automation): string {
  if (a.scheduleType === 'daily') return `每天 ${a.timeOfDay ?? '09:00'}`
  if (a.scheduleType === 'weekly') {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `每${names[a.dayOfWeek ?? 1]} ${a.timeOfDay ?? '09:00'}`
  }
  const min = a.intervalMinutes
  if (min < 60) return `每 ${min} 分钟`
  if (min < 1440) return `每 ${min / 60} 小时`
  return `每 ${min / 1440} 天`
}

export function AutomationsListView(): React.ReactElement {
  const automations = useAtomValue(automationsAtom)
  const setAutomations = useSetAtom(automationsAtom)
  const setForm = useSetAtom(automationFormAtom)

  const refreshList = React.useCallback(async () => {
    const list = await window.electronAPI.listAutomations()
    setAutomations(list)
  }, [setAutomations])

  const current = automations.filter((a) => a.active)
  const paused = automations.filter((a) => !a.active)

  const handleCreate = (): void => {
    // 自动命名「定时任务 N」：取现有最大 X + 1
    let maxN = 0
    for (const a of automations) {
      const m = /^定时任务\s*(\d+)$/.exec(a.name.trim())
      if (m) maxN = Math.max(maxN, Number(m[1]))
    }
    const draft = createEmptyDraft()
    draft.name = `定时任务 ${maxN + 1}`
    setForm({ open: true, draft })
  }

  const handleEdit = (a: Automation): void => {
    setForm({ open: true, draft: automationToDraft(a) })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 标题栏 */}
      {/* 空列表时隐藏右上角「新建」按钮，避免与空状态中心按钮重复 */}
      <div className="titlebar-drag-region flex items-center justify-between max-w-5xl w-full mx-auto px-8 pt-8 pb-6 flex-shrink-0">
        <h1 className="text-2xl font-semibold text-foreground">定时任务</h1>
        {automations.length > 0 && (
          <button
            type="button"
            onClick={handleCreate}
            className="titlebar-no-drag flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm"
          >
            <Plus size={14} />
            <span>新建定时任务</span>
          </button>
        )}
      </div>

      {/* 列表内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {automations.length === 0 ? (
          <EmptyState onCreate={handleCreate} />
        ) : (
          <div className="flex flex-col gap-8 max-w-5xl w-full mx-auto px-8 pb-8">
            {current.length > 0 && (
              <Section title="启用中" automations={current} onEdit={handleEdit} onRefresh={refreshList} variant="active" />
            )}
            {paused.length > 0 && (
              <Section title="已暂停" automations={paused} onEdit={handleEdit} onRefresh={refreshList} variant="paused" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface SectionProps {
  title: string
  automations: Automation[]
  onEdit: (a: Automation) => void
  onRefresh: () => Promise<void>
  variant: 'active' | 'paused'
}

function Section({ title, automations, onEdit, onRefresh, variant }: SectionProps): React.ReactElement {
  const handleRunNow = async (e: React.MouseEvent, a: Automation): Promise<void> => {
    e.stopPropagation()
    toast.success(`已开始运行「${a.name}」`, {
      description: '本次任务会创建新的 Agent 会话，可在左侧会话列表查看',
    })
    try {
      await window.electronAPI.runAutomationNow(a.id)
    } catch (err) {
      toast.error('运行失败')
      console.error('[定时任务] 立即运行失败:', err)
    }
  }

  const handleToggle = async (e: React.MouseEvent, a: Automation): Promise<void> => {
    e.stopPropagation()
    try {
      await window.electronAPI.toggleAutomation(a.id, !a.active)
      await onRefresh()
      toast.success(a.active ? '已暂停' : '已启用')
    } catch (err) {
      toast.error('操作失败')
      console.error('[定时任务] 切换状态失败:', err)
    }
  }

  const handleDelete = async (e: React.MouseEvent, a: Automation): Promise<void> => {
    e.stopPropagation()
    if (!window.confirm(`确定要删除定时任务「${a.name}」吗？`)) return
    try {
      await window.electronAPI.deleteAutomation(a.id)
      await onRefresh()
      toast.success('已删除')
    } catch (err) {
      toast.error('删除失败')
      console.error('[定时任务] 删除失败:', err)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-medium text-foreground/55 px-1">{title}</div>
      <div className="rounded-xl border border-border/50 overflow-hidden bg-content-area">
        {automations.map((a, i) => (
          // 行容器：用 div + role=button，避免与内部 button（立即运行/删除/暂停）
          // 形成嵌套 button 的非法 HTML，同时通过 keyDown 维持键盘可达。
          <div
            key={a.id}
            role="button"
            tabIndex={0}
            onClick={() => onEdit(a)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onEdit(a)
              }
            }}
            className={cn(
              'group w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.15] cursor-pointer focus:outline-none focus-visible:bg-foreground/[0.18]',
              i > 0 && 'border-t border-border/40',
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[14px] font-medium text-foreground truncate">{a.name}</span>
                <span className="text-[12px] text-foreground/45 truncate">
                  {a.prompt.slice(0, 60)}{a.prompt.length > 60 ? '…' : ''}
                </span>
              </div>
            </div>
            {/* 右侧槽位固定宽度，只切透明度，避免 hover 时列表行横向跳动。 */}
            <div className="relative h-7 w-24 shrink-0">
              <span className={cn(
                'absolute right-0 top-1/2 -translate-y-1/2 text-[12px] tabular-nums whitespace-nowrap transition-opacity group-hover:opacity-0',
                variant === 'active' ? 'text-foreground/55' : 'text-foreground/35',
              )}>
                {variant === 'paused' ? '已暂停' : formatSchedule(a)}
              </span>
              <div className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`立即运行 ${a.name}`}
                      onClick={(e) => { void handleRunNow(e, a) }}
                      className="p-1.5 rounded-md text-foreground/50 hover:text-foreground/85 hover:bg-foreground/[0.08] transition-colors"
                    >
                      <Play className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">立即运行一次</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`删除 ${a.name}`}
                      onClick={(e) => { void handleDelete(e, a) }}
                      className="p-1.5 rounded-md text-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">删除任务</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={a.active ? `暂停 ${a.name}` : `启用 ${a.name}`}
                  onClick={(e) => { void handleToggle(e, a) }}
                  className={cn(
                    'p-1.5 -m-1.5 shrink-0 flex items-center justify-center rounded-md transition-colors',
                    a.active
                      ? 'text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/70 group-hover:text-foreground/55'
                      : 'text-foreground/30 hover:bg-emerald-500/10 hover:text-emerald-500 group-hover:text-foreground/45',
                  )}
                >
                  {a.active ? <Pause className="size-3.5" /> : <Power className="size-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {a.active ? '暂停任务：从当前开始不再继续后续自动处理' : '启用任务'}
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <div className="max-w-2xl mx-auto pt-24 flex flex-col items-center text-center gap-4">
      <div className="size-16 rounded-2xl bg-foreground/[0.04] flex items-center justify-center">
        <Clock className="size-8 text-foreground/30" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[16px] font-medium text-foreground/85">暂无定时任务</div>
        <div className="text-[13px] text-foreground/50 leading-relaxed max-w-md">
          定时任务可以让 AI 周期性地执行某项任务，如每天总结新邮件、每小时检查 GitHub 仓库等。
          也可以在对话中用「以后每隔 X 分钟…」让 Proma 自动识别并创建。
        </div>
      </div>
      <button
        type="button"
        onClick={onCreate}
	        className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
      >
        <Plus size={14} />
        <span>新建定时任务</span>
      </button>
    </div>
  )
}
