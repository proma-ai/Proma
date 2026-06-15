/**
 * 定时任务表单视图（Codex 风格，覆盖在中间内容区，非弹窗）
 *
 * 两栏布局：
 * - 左：大的自然语言任务描述输入框（主角）
 * - 右：配置栏（启用 / 状态信息 / 调度模式 / 模型 / 工作区 / 运行历史）
 *
 * 表单打开时 AppShell 会隐藏右侧文件面板，中间区域扩展到全宽。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Bell, Check, Clock, Loader2, Pencil, Play, Settings, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ModelSelector } from '@/components/chat/ModelSelector'
import {
  automationFormAtom,
  automationsAtom,
  AUTOMATION_INTERVAL_OPTIONS,
  AUTOMATION_WEEKDAY_OPTIONS,
  automationToDraft,
  type AutomationDraft,
} from '@/atoms/automation-atoms'
import { agentWorkspacesAtom, agentSessionsAtom, agentChannelIdsAtom } from '@/atoms/agent-atoms'
import { activeSessionIdAtom } from '@/atoms/tab-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { useOpenSession } from '@/hooks/useOpenSession'
import { MarkdownRichEditor } from '@/components/diff/MarkdownRichEditor'
import type {
  AutomationFeishuNotificationTarget,
  AutomationNotificationTarget,
  AutomationRun,
  AutomationSessionMode,
  CreateAutomationInput,
  FeishuChatBinding,
  UpdateAutomationInput,
} from '@proma/shared'

const NO_WORKSPACE = '__none__'
const NO_FEISHU_BINDING = '__none__'

function formatTime(ts?: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatRunStatus(status: AutomationRun['status']): string {
  if (status === 'success') return '完成'
  if (status === 'error') return '失败'
  return '跳过'
}

function canPersistDraft(draft: AutomationDraft): boolean {
  return !!(draft.name.trim() && draft.prompt.trim() && draft.channelId)
}

function getDraftSignature(draft: AutomationDraft): string {
  return JSON.stringify({
    id: draft.id ?? '',
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    scheduleType: draft.scheduleType,
    intervalMinutes: draft.intervalMinutes,
    timeOfDay: draft.timeOfDay ?? '',
    dayOfWeek: draft.dayOfWeek ?? '',
    dayOfMonth: draft.dayOfMonth ?? '',
    channelId: draft.channelId,
    modelId: draft.modelId ?? '',
    workspaceId: draft.workspaceId ?? '',
    permissionMode: draft.permissionMode,
    sessionMode: draft.sessionMode,
    notificationTargets: draft.notificationTargets ?? [],
    active: draft.active,
  })
}

function draftToCreateInput(draft: AutomationDraft): CreateAutomationInput {
  return {
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    scheduleType: draft.scheduleType,
    intervalMinutes: draft.intervalMinutes,
    timeOfDay: draft.timeOfDay,
    dayOfWeek: draft.dayOfWeek,
    dayOfMonth: draft.dayOfMonth,
    channelId: draft.channelId,
    modelId: draft.modelId,
    workspaceId: draft.workspaceId,
    permissionMode: draft.permissionMode,
    sessionMode: draft.sessionMode,
    notificationTargets: draft.notificationTargets,
    sourceSessionId: draft.sourceSessionId,
    active: draft.active,
  }
}

function draftToUpdateInput(draft: AutomationDraft): UpdateAutomationInput {
  return {
    id: draft.id ?? '',
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    scheduleType: draft.scheduleType,
    intervalMinutes: draft.intervalMinutes,
    timeOfDay: draft.timeOfDay,
    dayOfWeek: draft.dayOfWeek,
    dayOfMonth: draft.dayOfMonth,
    channelId: draft.channelId,
    modelId: draft.modelId,
    workspaceId: draft.workspaceId ?? '',
    permissionMode: draft.permissionMode,
    sessionMode: draft.sessionMode,
    notificationTargets: draft.notificationTargets ?? [],
    active: draft.active,
  }
}

function getFeishuTarget(targets?: AutomationNotificationTarget[]): AutomationFeishuNotificationTarget | undefined {
  return targets?.find((target): target is AutomationFeishuNotificationTarget => target.type === 'feishu')
}

function getFeishuBindingValue(binding: FeishuChatBinding): string {
  return `${binding.botId}::${binding.chatId}`
}

function formatFeishuBinding(binding: FeishuChatBinding): string {
  const name = binding.chatType === 'group'
    ? binding.groupName || '未命名群聊'
    : '飞书单聊'
  return `${name} · ${binding.botId.slice(0, 8)}`
}

function createFeishuTarget(binding: FeishuChatBinding): AutomationFeishuNotificationTarget {
  return {
    type: 'feishu',
    enabled: true,
    trigger: 'always',
    botId: binding.botId,
    chatId: binding.chatId,
  }
}

function AutomationPromptEmptyGuide(): React.ReactElement {
  return (
    <div className="rounded-xl bg-foreground/[0.035] p-4 shadow-inner">
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[13px] font-semibold text-foreground">推荐：让 Proma Agent 创建</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
            在左侧会话里说清目标，并明确表示要求创建定时任务，Proma Agent 会生成任务描述，并补全周期、工作区和模型等配置，手动编辑更适合微调任务描述。
          </div>
        </div>
        <div className="h-px bg-border/50" />
        <div>
          <div className="text-[13px] font-medium text-foreground/85">手动编写时，只写任务本身</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
            例：检查 Proma 仓库新增 issue，主动回复问答类问题，不清楚的部分整理到工作区目录下的 .context/issue-faq.md 文档；真正的 Bug 或请求罗列后发给我，不要记录任何重复的信息。
          </div>
        </div>
      </div>
    </div>
  )
}

export function AutomationFormView(): React.ReactElement | null {
  const [formState, setFormState] = useAtom(automationFormAtom)
  const setAutomations = useSetAtom(automationsAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const automations = useAtomValue(automationsAtom)
  const agentChannelIds = useAtomValue(agentChannelIdsAtom)
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const openSession = useOpenSession()

  const [form, setForm] = React.useState<AutomationDraft | null>(null)
  const [editingName, setEditingName] = React.useState(false)
  const [runningNow, setRunningNow] = React.useState(false)
  const [feishuBindings, setFeishuBindings] = React.useState<FeishuChatBinding[]>([])
  const nameInputRef = React.useRef<HTMLInputElement>(null)
  const saveTimerRef = React.useRef<number | undefined>(undefined)
  const lastSavedSignatureRef = React.useRef('')
  const latestFormRef = React.useRef<AutomationDraft | null>(null)
  // 串行化保存，避免新建草稿在首次 create 返回前被重复创建。
  const persistInFlightRef = React.useRef<Promise<string | null> | null>(null)

  // 卸载/关闭过程中不再 setState（保存 IPC 是异步的，结束时表单可能已经被关掉了）
  const isMountedRef = React.useRef(true)
  React.useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  React.useEffect(() => {
    if (formState.open && formState.draft) {
      setForm({ ...formState.draft })
      lastSavedSignatureRef.current = formState.draft.id && canPersistDraft(formState.draft)
        ? getDraftSignature(formState.draft)
        : ''
    }
  }, [formState.open, formState.draft])

  React.useEffect(() => {
    if (!formState.open) return
    window.electronAPI.listFeishuBindings()
      .then(setFeishuBindings)
      .catch((err: unknown) => {
        console.error('[定时任务] 获取飞书绑定失败:', err)
      })
  }, [formState.open])

  React.useEffect(() => {
    latestFormRef.current = form
  }, [form])

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const refreshAutomations = React.useCallback(async () => {
    const list = await window.electronAPI.listAutomations()
    setAutomations(list)
    return list
  }, [setAutomations])

  const persistDraft = React.useCallback((draft: AutomationDraft): Promise<string | null> => {
    if (!canPersistDraft(draft)) return Promise.resolve(draft.id ?? null)

    const previousPersist = persistInFlightRef.current
    const persistTask = (async (): Promise<string | null> => {
      const previousId = previousPersist ? await previousPersist.catch(() => null) : null
      const latestDraft = latestFormRef.current
      const draftToSave = latestDraft
        ? { ...latestDraft, id: latestDraft.id ?? previousId ?? draft.id }
        : { ...draft, id: draft.id ?? previousId ?? undefined }

      if (!canPersistDraft(draftToSave)) return draftToSave.id ?? null

      const signature = getDraftSignature(draftToSave)
      if (signature === lastSavedSignatureRef.current) return draftToSave.id ?? null

      try {
        if (draftToSave.id) {
          const updated = await window.electronAPI.updateAutomation(draftToUpdateInput(draftToSave))
          if (!updated) throw new Error('定时任务不存在')
          lastSavedSignatureRef.current = signature
          setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
          setForm((prev) => (prev ? { ...prev, id: updated.id, name: updated.name } : prev))
          return updated.id
        } else {
          const created = await window.electronAPI.createAutomation(draftToCreateInput(draftToSave))
          const createdDraft = automationToDraft(created)
          lastSavedSignatureRef.current = getDraftSignature(createdDraft)
          setAutomations((prev) => [created, ...prev.filter((a) => a.id !== created.id)])
          setForm((prev) => (prev ? { ...prev, id: created.id, name: created.name } : prev))
          return created.id
        }
      } catch (err) {
        console.error('[定时任务] 自动保存失败:', err)
        if (isMountedRef.current) toast.error('自动保存失败')
        return null
      }
    })()

    persistInFlightRef.current = persistTask
    void persistTask.finally(() => {
      if (persistInFlightRef.current === persistTask) {
        persistInFlightRef.current = null
      }
    })
    return persistTask
  }, [setAutomations])

  React.useEffect(() => {
    if (!formState.open || !form || !canPersistDraft(form)) return

    const signature = getDraftSignature(form)
    if (signature === lastSavedSignatureRef.current) return

    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      void persistDraft(form)
    }, 500)

    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = undefined
      }
    }
  }, [form, formState.open, persistDraft])

  // 切换会话/Tab 时自动关闭表单
  const initialSessionRef = React.useRef<string | null | undefined>(undefined)
  React.useEffect(() => {
    if (!formState.open) {
      initialSessionRef.current = undefined
      return
    }
    if (initialSessionRef.current === undefined) {
      initialSessionRef.current = activeSessionId
      return
    }
    if (activeSessionId !== initialSessionRef.current) {
      const latest = latestFormRef.current
      if (latest) void persistDraft(latest)
      setFormState({ open: false, draft: null })
    }
  }, [activeSessionId, formState.open, persistDraft, setFormState])

  const [dayPopoverOpen, setDayPopoverOpen] = React.useState(false)

  if (!formState.open || !form) return null

  // 编辑模式下取实时的 automation（用于状态信息 + 运行历史，订阅 changed 后会刷新）
  const live = form.id ? automations.find((a) => a.id === form.id) : undefined

  const close = (): void => {
    const latest = latestFormRef.current
    if (latest) void persistDraft(latest)
    setFormState({ open: false, draft: null })
  }
  const update = (patch: Partial<AutomationDraft>): void => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const updateFeishuNotification = (target: AutomationFeishuNotificationTarget | null): void => {
    update({ notificationTargets: target ? [target] : [] })
  }

  const handleRunNow = async (): Promise<void> => {
    const latest = latestFormRef.current
    if (!latest || !canPersistDraft(latest)) {
      toast.error('请先填写任务名称、任务描述并选择模型')
      return
    }

    setRunningNow(true)
    toast.success('已开始运行定时任务', {
      description: '本次任务会创建新的 Agent 会话，可在左侧会话列表查看',
    })
    try {
      const automationId = await persistDraft(latest)
      if (!automationId) throw new Error('任务尚未创建')
      await window.electronAPI.runAutomationNow(automationId)
      await refreshAutomations()
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
    } catch (err) {
      console.error('[定时任务] 立即运行失败:', err)
      toast.error('立即运行失败')
    } finally {
      if (isMountedRef.current) setRunningNow(false)
    }
  }

  /** 跳到运行历史中的某次子会话，先关掉表单 overlay 再 openSession */
  const handleOpenRunSession = async (run: AutomationRun): Promise<void> => {
    if (!run.sessionId) {
      toast.error('这条记录没有可打开的会话')
      return
    }

    let session = agentSessions.find((s) => s.id === run.sessionId)
    if (!session) {
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
      session = sessions.find((s) => s.id === run.sessionId)
    }

    if (!session) {
      toast.error('该会话已不存在')
      return
    }

    const latest = latestFormRef.current
    if (latest) void persistDraft(latest)
    setFormState({ open: false, draft: null })
    setActiveView('conversations')
    openSession('agent', session.id, session.title)
  }

  const startEditName = (): void => {
    setEditingName(true)
    requestAnimationFrame(() => nameInputRef.current?.focus())
  }
  const commitName = async (): Promise<void> => {
    const name = form.name.trim()
    if (!name) {
      toast.error('任务名称不能为空')
      nameInputRef.current?.focus()
      return
    }
    setEditingName(false)
    update({ name })
    void persistDraft({ ...form, name })
  }
  const handleNameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitName()
    } else if (e.key === 'Escape') {
      setForm((prev) => (prev ? { ...prev, name: live?.name ?? formState.draft?.name ?? prev.name } : prev))
      setEditingName(false)
    }
  }

  const isEdit = !!form.id

  const selectedModel = form.channelId && form.modelId
    ? { channelId: form.channelId, modelId: form.modelId }
    : null
  const feishuTarget = getFeishuTarget(form.notificationTargets)
  const selectedFeishuBinding = feishuTarget
    ? feishuBindings.find((binding) => binding.botId === feishuTarget.botId && binding.chatId === feishuTarget.chatId)
    : undefined
  const selectedFeishuBindingValue = selectedFeishuBinding
    ? getFeishuBindingValue(selectedFeishuBinding)
    : NO_FEISHU_BINDING

  return (
    <div className="titlebar-no-drag absolute inset-0 z-10 bg-content-area flex animate-in fade-in duration-200">
      {/* 左栏：自然语言任务描述（主角） */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 px-6 py-4 flex-shrink-0">
          <button
            type="button"
            onClick={close}
            className="titlebar-no-drag mr-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            aria-label="返回任务列表"
          >
            <ArrowLeft className="size-3.5" />
            <span>自动任务</span>
          </button>
          <Clock className="size-4 text-primary flex-shrink-0" />
          {editingName ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                ref={nameInputRef}
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                onKeyDown={handleNameKeyDown}
                onBlur={() => { void commitName() }}
                placeholder="未命名任务"
                className="flex-1 bg-transparent text-sm font-semibold text-foreground border-b border-primary/50 outline-none px-0 py-0.5 min-w-0"
                maxLength={100}
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { void commitName() }}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <Check className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="truncate text-sm font-semibold text-foreground">
                {form.name.trim() || (isEdit ? '未命名任务' : '新建定时任务')}
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={startEditName}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                aria-label="重命名任务"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 px-6 pb-6 flex flex-col gap-3">
          <div className="flex items-center">
            <Label htmlFor="automation-prompt" className="text-xs font-medium text-muted-foreground">
              任务编写
            </Label>
          </div>
          <div className="min-h-0 flex-1">
            <div className="flex h-full min-h-0 flex-col gap-3">
              <AutomationPromptEmptyGuide />
              <div
                id="automation-prompt"
                className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-foreground/[0.03] shadow-inner scrollbar-thin"
              >
                <MarkdownRichEditor
                  value={form.prompt}
                  editing
                  onChange={(value) => update({ prompt: value })}
                  onSave={() => undefined}
                  onCancel={() => undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 右栏：配置 sidebar */}
      <div className="w-[340px] flex-shrink-0 border-l border-border/50 flex flex-col bg-content-area">
        <div className="flex items-center justify-between gap-2 px-4 py-4 flex-shrink-0">
          <span className="text-sm font-semibold text-foreground">配置</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { void handleRunNow() }}
              disabled={runningNow || !canPersistDraft(form)}
              className="titlebar-no-drag h-7 px-2.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {runningNow ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              <span>{runningNow ? '运行中' : '运行一次'}</span>
            </button>
            <button
              onClick={close}
              className="titlebar-no-drag p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-5">
          {/* 启用开关（最上） */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="auto-active">启用</Label>
              <span className="text-xs text-muted-foreground">关闭后任务暂停调度</span>
            </div>
            <Switch
              id="auto-active"
              checked={form.active}
              onCheckedChange={(checked) => update({ active: checked })}
            />
          </div>

          {/* 状态信息（编辑模式显示） */}
          {isEdit && (
            <div className="rounded-lg bg-foreground/[0.03] p-3 flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">上次运行</span>
                <span className="text-foreground/80 tabular-nums">{formatTime(live?.lastRunAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">下次运行</span>
                <span className="text-foreground/80 tabular-nums">
                  {live?.active ? formatTime(live?.nextRunAt) : '已暂停'}
                </span>
              </div>
            </div>
          )}

          {/* 调度模式 */}
          <div className="flex flex-col gap-2">
            <Label>运行频率</Label>
            <Select
              value={form.scheduleType}
              onValueChange={(v) => update({ scheduleType: v as AutomationDraft['scheduleType'] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">每隔一段时间</SelectItem>
                <SelectItem value="daily">每天定点</SelectItem>
                <SelectItem value="weekly">每周定点</SelectItem>
                <SelectItem value="monthly">每月定点</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* interval 模式：自定义分钟 */}
          {form.scheduleType === 'interval' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="auto-interval">运行间隔（分钟）</Label>
              <div className="flex items-center gap-2">
                <input
                  id="auto-interval"
                  type="number"
                  min={1}
                  value={form.intervalMinutes}
                  onChange={(e) => update({ intervalMinutes: Math.max(1, Number(e.target.value) || 1) })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <span className="text-xs text-muted-foreground shrink-0">分钟一次</span>
              </div>
            </div>
          )}

          {/* daily 模式：时刻 */}
          {form.scheduleType === 'daily' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="auto-time">时刻</Label>
              <input
                id="auto-time"
                type="time"
                value={form.timeOfDay ?? '09:00'}
                onChange={(e) => update({ timeOfDay: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}

          {/* weekly 模式：星期 + 时刻 同一行 */}
          {form.scheduleType === 'weekly' && (
            <div className="flex flex-col gap-2">
              <Label>每周</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={String(form.dayOfWeek ?? 1)}
                  onValueChange={(v) => update({ dayOfWeek: Number(v) })}
                >
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUTOMATION_WEEKDAY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="time"
                  value={form.timeOfDay ?? '09:00'}
                  onChange={(e) => update({ timeOfDay: e.target.value })}
                  className="flex h-9 w-[120px] shrink-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          {/* monthly 模式：日期网格 + 时刻 */}
          {form.scheduleType === 'monthly' && (
            <div className="flex flex-col gap-2">
              <Label>每月</Label>
              <div className="flex items-center gap-2">
                <Popover open={dayPopoverOpen} onOpenChange={setDayPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 flex-1 items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span>{form.dayOfMonth ?? 1} 号</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <div className="grid grid-cols-7 gap-0.5">
                      {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
                        <div key={d} className="flex h-7 items-center justify-center text-[11px] font-medium text-muted-foreground">
                          {d}
                        </div>
                      ))}
                      {Array.from({ length: 31 }, (_, i) => {
                        const day = i + 1
                        const selected = (form.dayOfMonth ?? 1) === day
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => { update({ dayOfMonth: day }); setDayPopoverOpen(false) }}
                            className={cn(
                              'flex h-7 items-center justify-center rounded-md text-[13px] transition-colors',
                              selected
                                ? 'bg-primary text-primary-foreground'
                                : 'text-foreground hover:bg-foreground/[0.06]',
                            )}
                          >
                            {day}
                          </button>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                <input
                  type="time"
                  value={form.timeOfDay ?? '09:00'}
                  onChange={(e) => update({ timeOfDay: e.target.value })}
                  className="flex h-9 w-[120px] shrink-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              {form.dayOfMonth !== undefined && form.dayOfMonth >= 29 && (
                <span className="pl-2.5 text-xs text-muted-foreground leading-relaxed">
                  如当月无 {form.dayOfMonth} 日，将在当月最后一天执行
                </span>
              )}
            </div>
          )}

          {/* 选择模型（定时任务只能跑 Agent，因此只显示已勾选为 Agent 兼容的渠道模型） */}
          <div className="flex flex-col gap-2">
            <Label>选择模型</Label>
            {agentChannelIds.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                <Settings size={14} className="shrink-0" />
                <span>尚未启用任何 Agent 兼容渠道</span>
                <button
                  type="button"
                  className="ml-auto text-xs underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => {
                    setSettingsTab('channels')
                    setSettingsOpen(true)
                  }}
                >
                  前往渠道设置
                </button>
              </div>
            ) : (
              <ModelSelector
                filterChannelIds={agentChannelIds}
                externalSelectedModel={selectedModel}
                showChannelInTrigger
                onModelSelect={(opt) => update({ channelId: opt.channelId, modelId: opt.modelId })}
              />
            )}
          </div>

          {/* 工作区 */}
          <div className="flex flex-col gap-2">
            <Label>工作区</Label>
            <Select
              value={form.workspaceId ?? NO_WORKSPACE}
              onValueChange={(v) => update({ workspaceId: v === NO_WORKSPACE ? undefined : v })}
            >
              <SelectTrigger><SelectValue placeholder="选择工作区" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_WORKSPACE}>无工作区</SelectItem>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 飞书通知 */}
          <div className="flex flex-col gap-2 rounded-lg bg-foreground/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <Bell className="size-4 shrink-0 mt-0.5 text-primary" />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="auto-feishu-notify">飞书通知</Label>
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    任务结束后把结果推送到已有飞书绑定
                  </span>
                </div>
              </div>
              <Switch
                id="auto-feishu-notify"
                checked={feishuTarget?.enabled === true}
                onCheckedChange={(checked) => {
                  if (!checked) {
                    updateFeishuNotification(null)
                    return
                  }
                  const target = selectedFeishuBinding ?? feishuBindings[0]
                  if (!target) {
                    toast.error('暂无飞书绑定，请先在飞书里向 Bot 发送一条消息')
                    return
                  }
                  updateFeishuNotification(feishuTarget
                    ? { ...feishuTarget, enabled: true }
                    : createFeishuTarget(target))
                }}
              />
            </div>

            {feishuTarget?.enabled === true && (
              <div className="flex flex-col gap-2 pt-1">
                <Select
                  value={selectedFeishuBindingValue}
                  onValueChange={(value) => {
                    const binding = feishuBindings.find((item) => getFeishuBindingValue(item) === value)
                    if (!binding) return
                    updateFeishuNotification({
                      ...createFeishuTarget(binding),
                      trigger: feishuTarget.trigger,
                    })
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="选择飞书聊天" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FEISHU_BINDING} disabled>
                      {feishuBindings.length === 0 ? '暂无飞书绑定' : '选择飞书聊天'}
                    </SelectItem>
                    {feishuBindings.map((binding) => (
                      <SelectItem key={getFeishuBindingValue(binding)} value={getFeishuBindingValue(binding)}>
                        {formatFeishuBinding(binding)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={feishuTarget.trigger}
                  onValueChange={(value) => {
                    updateFeishuNotification({
                      ...feishuTarget,
                      trigger: value as AutomationFeishuNotificationTarget['trigger'],
                    })
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">成功或失败都通知</SelectItem>
                    <SelectItem value="success">仅成功时通知</SelectItem>
                    <SelectItem value="error">仅失败时通知</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* 会话模式 */}
          <div className="flex flex-col gap-2">
            <Label>会话模式</Label>
            <Select
              value={form.sessionMode}
              onValueChange={(v) => update({ sessionMode: v as AutomationSessionMode })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">每次新建会话</SelectItem>
                <SelectItem value="reuse">复用上次会话</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {form.sessionMode === 'reuse'
                ? '每次触发时继续上次的子会话，保留对话上下文（首次运行会自动新建）。'
                : '每次触发都新建独立子会话，互不干扰。'}
            </span>
          </div>

          {/* 权限模式 */}
          <div className="flex flex-col gap-2">
            <Label>运行权限</Label>
            <Select
              value={form.permissionMode}
              onValueChange={(v) => update({ permissionMode: v as AutomationDraft['permissionMode'] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bypassPermissions">完全自动</SelectItem>
                <SelectItem value="auto">自动审批</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {form.permissionMode === 'bypassPermissions'
                ? '所有工具调用自动允许（推荐用于无人值守）。'
                : '由 SDK 内置审批器判断，危险操作仍会请求确认；无人值守时这些请求会一直挂起，需手动到会话中处理。'}
            </span>
          </div>

          {form.permissionMode === 'bypassPermissions' && (
            <div className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>此任务将以「完全权限」无人值守运行，可自主读写文件、执行命令。请确认任务内容安全可信。</span>
            </div>
          )}

          {/* 运行历史（编辑模式） */}
          {isEdit && live && (
            <div className="flex flex-col gap-1.5">
              <Label>运行历史</Label>
              {live.runHistory.length === 0 ? (
                <div className="text-xs text-muted-foreground py-1">暂无运行记录</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {live.runHistory.slice(0, 10).map((run, i) => {
                    const hasSessionId = !!run.sessionId
                    return (
                      <Tooltip key={`${run.runAt}-${i}`}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => { void handleOpenRunSession(run) }}
                            disabled={!hasSessionId}
                            title={hasSessionId ? undefined : '这条记录没有可打开的会话'}
                            className="flex items-center gap-2 px-1.5 py-1 -mx-1.5 rounded-md text-[11px] text-foreground/60 text-left transition-colors enabled:hover:bg-foreground/[0.04] enabled:hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="tabular-nums">{formatTime(run.runAt)}</span>
                            <span className="shrink-0 text-foreground/45">{formatRunStatus(run.status)}</span>
                            <span className="text-foreground/35 truncate">
                              {run.status === 'success' && run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : ''}
                              {run.status === 'error' ? (run.error ?? '失败') : ''}
                              {run.status === 'skipped' ? (run.skipReason ?? '跳过') : ''}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {hasSessionId ? '点击以跳转到该次会话' : '这条记录没有可打开的会话'}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
