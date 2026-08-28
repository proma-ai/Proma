import { atom } from 'jotai'
import type { ActivePlanningReminder, CalendarEvent, PlanningGroup, PlanningTag, Todo } from '@proma/shared'

export type PlanningTab = 'todos' | 'calendar' | 'automations'

export const todosAtom = atom<Todo[]>([])
export const calendarEventsAtom = atom<CalendarEvent[]>([])
/** Todo 与日程分组分开维护，避免任何调用方意外混用。 */
export const todoPlanningGroupsAtom = atom<PlanningGroup[]>([])
export const calendarPlanningGroupsAtom = atom<PlanningGroup[]>([])
export const planningTagsAtom = atom<PlanningTag[]>([])
export const activePlanningRemindersAtom = atom<ActivePlanningReminder[]>([])
export const planningTabAtom = atom<PlanningTab>('todos')
/** 外部提醒等入口可指定要在 Todo 工作区中打开的任务。 */
export const planningSelectedTodoIdAtom = atom<string | null>(null)
export const planningSelectedCalendarEventIdAtom = atom<string | null>(null)
/** 页头等外部入口递增该值，Todo 工作区收到后打开创建 Popup。 */
export const planningTodoCreateRequestAtom = atom(0)
/** 页头和快捷键递增该值，日程工作区收到后打开创建表单。 */
export const planningCalendarCreateRequestAtom = atom(0)
