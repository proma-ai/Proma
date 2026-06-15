/**
 * 定时任务（Automation）状态管理
 *
 * - automationsAtom：任务列表（由初始化器从主进程加载并订阅变更刷新）
 * - automationFormAtom：创建/编辑表单的开关 + 草稿（表单复用中间内容区，非弹窗）
 */

import { atom } from 'jotai'
import type {
  Automation,
  AutomationNotificationTarget,
  AutomationScheduleType,
  AutomationPermissionMode,
  AutomationSessionMode,
} from '@proma/shared'
import { AUTOMATION_DEFAULT_PERMISSION_MODE, AUTOMATION_DEFAULT_SESSION_MODE } from '@proma/shared'

/** 全部定时任务列表 */
export const automationsAtom = atom<Automation[]>([])

/**
 * 表单草稿
 * - 无 id：创建模式
 * - 有 id：编辑模式（预填已有任务字段）
 */
export interface AutomationDraft {
  /** 编辑模式下的任务 id；创建模式为空 */
  id?: string
  name: string
  prompt: string
  scheduleType: AutomationScheduleType
  intervalMinutes: number
  timeOfDay?: string
  dayOfWeek?: number
  dayOfMonth?: number
  channelId: string
  modelId?: string
  workspaceId?: string
  permissionMode: AutomationPermissionMode
  sessionMode: AutomationSessionMode
  notificationTargets?: AutomationNotificationTarget[]
  sourceSessionId?: string
  active: boolean
}

/** 表单视图状态（覆盖在中间内容区） */
export interface AutomationFormState {
  open: boolean
  draft: AutomationDraft | null
}

export const automationFormAtom = atom<AutomationFormState>({
  open: false,
  draft: null,
})

/** 创建一个空白草稿（用于「+ 新建」） */
export function createEmptyDraft(): AutomationDraft {
  return {
    name: '',
    prompt: '',
    scheduleType: 'interval',
    intervalMinutes: 10,
    timeOfDay: '09:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    channelId: '',
    permissionMode: AUTOMATION_DEFAULT_PERMISSION_MODE,
    sessionMode: AUTOMATION_DEFAULT_SESSION_MODE,
    active: true,
  }
}

/**
 * 把已存在的 Automation 映射成表单草稿（编辑入口共用）。
 * 集中映射避免新增字段时漏改某个调用点。
 */
export function automationToDraft(a: Automation): AutomationDraft {
  return {
    id: a.id,
    name: a.name,
    prompt: a.prompt,
    scheduleType: a.scheduleType,
    intervalMinutes: a.intervalMinutes,
    timeOfDay: a.timeOfDay,
    dayOfWeek: a.dayOfWeek,
    dayOfMonth: a.dayOfMonth,
    channelId: a.channelId,
    modelId: a.modelId,
    workspaceId: a.workspaceId,
    permissionMode: a.permissionMode ?? AUTOMATION_DEFAULT_PERMISSION_MODE,
    sessionMode: a.sessionMode ?? AUTOMATION_DEFAULT_SESSION_MODE,
    notificationTargets: a.notificationTargets,
    sourceSessionId: a.sourceSessionId,
    active: a.active,
  }
}

/** 固定间隔选项（分钟） */
export const AUTOMATION_INTERVAL_OPTIONS = [
  { label: '每 5 分钟', value: 5 },
  { label: '每 10 分钟', value: 10 },
  { label: '每 30 分钟', value: 30 },
  { label: '每 1 小时', value: 60 },
  { label: '每 3 小时', value: 180 },
  { label: '每 6 小时', value: 360 },
  { label: '每 12 小时', value: 720 },
] as const

/** 星期选项（0=周日） */
export const AUTOMATION_WEEKDAY_OPTIONS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
] as const

