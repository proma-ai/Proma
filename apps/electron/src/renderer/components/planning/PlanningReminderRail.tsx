import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { BellRing, Check, ListTodo, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ActivePlanningReminder } from '@proma/shared'
import { activePlanningRemindersAtom, planningSelectedTodoIdAtom, planningTabAtom } from '@/atoms/planning-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { notificationsEnabledAtom, notificationSoundEnabledAtom, notificationSoundsAtom, playNotificationSoundForType } from '@/atoms/notifications'
import { Button } from '@/components/ui/button'

function formatTriggerTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(timestamp)
}

function mergeReminders(current: ActivePlanningReminder[], incoming: ActivePlanningReminder[]): ActivePlanningReminder[] {
  const items = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) items.set(item.id, item)
  return [...items.values()].sort((a, b) => (a.snoozedUntil ?? a.triggerAt) - (b.snoozedUntil ?? b.triggerAt))
}

/** 全局常驻提醒条。未确认提醒从 SQLite 恢复，不依赖一次性 toast 生命周期。 */
export function PlanningReminderRail({ playSound = true }: { playSound?: boolean } = {}): React.ReactElement | null {
  const [reminders, setReminders] = useAtom(activePlanningRemindersAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setPlanningTab = useSetAtom(planningTabAtom)
  const setSelectedTodoId = useSetAtom(planningSelectedTodoIdAtom)
  const notificationsEnabled = useAtomValue(notificationsEnabledAtom)
  const soundEnabled = useAtomValue(notificationSoundEnabledAtom)
  const sounds = useAtomValue(notificationSoundsAtom)

  const load = React.useCallback(async () => {
    try {
      setReminders(await window.electronAPI.listActivePlanningReminders())
    } catch (error) {
      console.error('[任务/日程] 加载常驻提醒失败:', error)
    }
  }, [setReminders])

  React.useEffect(() => {
    void load()
    const unsubscribeDue = window.electronAPI.onPlanningRemindersDue((due) => {
      setReminders((current) => mergeReminders(current, due))
      if (playSound && notificationsEnabled && soundEnabled && due.length > 0) {
        void playNotificationSoundForType('planningReminder', sounds)
      }
    })
    const unsubscribeChanged = window.electronAPI.onPlanningChanged((change) => {
      if (change.resources.includes('reminders')) void load()
    })
    return () => { unsubscribeDue(); unsubscribeChanged() }
  }, [load, notificationsEnabled, playSound, setReminders, soundEnabled, sounds])

  const acknowledge = async (id: string) => {
    try {
      await window.electronAPI.acknowledgePlanningReminder(id)
    } catch (error) {
      console.error('[任务/日程] 确认提醒失败:', error)
      toast.error('确认提醒失败')
    }
  }
  const completeTodo = async (reminder: ActivePlanningReminder) => {
    try {
      await window.electronAPI.updateTodo({ id: reminder.targetId, status: 'completed' })
    } catch (error) {
      console.error('[任务/日程] 完成 Todo 失败:', error)
      toast.error('完成 Todo 失败')
    }
  }
  const openTodo = (reminder: ActivePlanningReminder): void => {
    setPlanningTab('todos')
    setSelectedTodoId(reminder.targetId)
    setActiveView('planning')
  }
  const snooze = async (id: string, minutes: number) => {
    try {
      await window.electronAPI.snoozePlanningReminder({ id, minutes })
    } catch (error) {
      console.error('[任务/日程] 推迟提醒失败:', error)
      toast.error('推迟提醒失败')
    }
  }

  if (reminders.length === 0) return null

  return (
    <aside className="fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col-reverse gap-2" aria-live="polite">
      {reminders.slice(0, 3).map((reminder) => {
        return (
          <section key={reminder.id} className="bg-background shadow-lg">
            <div className="flex items-start gap-3 px-3 py-3">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium">{reminder.targetTitle}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatTriggerTime(reminder.snoozedUntil ?? reminder.triggerAt)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  <span>{reminder.targetType === 'todo' ? 'Todo' : '日程'}</span>
                  {reminder.group && <span>{reminder.group.name}</span>}
                  {reminder.tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void acknowledge(reminder.id)} aria-label="关闭提醒" title="关闭提醒">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1 bg-muted/20 px-3 py-2">
              {reminder.targetType === 'todo' && (
                <>
                  <Button variant="secondary" size="sm" className="h-7" onClick={() => openTodo(reminder)}>
                    <ListTodo className="mr-1 h-3.5 w-3.5" />查看 Todo
                  </Button>
                  <Button variant="secondary" size="sm" className="h-7" onClick={() => void completeTodo(reminder)}>
                    <Check className="mr-1 h-3.5 w-3.5" />完成
                  </Button>
                </>
              )}
              {[5, 10, 30, 60].map((minutes) => (
                <Button key={minutes} variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void snooze(reminder.id, minutes)}>
                  {minutes} 分钟
                </Button>
              ))}
            </div>
          </section>
        )
      })}
      {reminders.length > 3 && <p className="px-2 text-right text-xs text-muted-foreground">另有 {reminders.length - 3} 条待处理提醒</p>}
    </aside>
  )
}
