import type {
  PlanningNativeSyncEntity,
  PlanningNativeSyncPermission,
  PlanningNativeSyncStatus,
  PlanningNativeSyncTarget,
} from '@proma/shared'
import { callMacEventKitNativeAddon, subscribeMacEventKitNativeChanges } from './mac-eventkit-native-addon'

type NativePermissionResponse = {
  entity: PlanningNativeSyncEntity
  status: PlanningNativeSyncPermission
  granted?: boolean
  error?: string
}

function eventKitSupported(): boolean {
  if (process.platform !== 'darwin') return false
  const major = Number.parseInt(process.getSystemVersion().split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major >= 14
}

function unsupportedPermission(entity: PlanningNativeSyncEntity): NativePermissionResponse {
  return { entity, status: 'unsupported' }
}

async function getPermission(entity: PlanningNativeSyncEntity): Promise<NativePermissionResponse> {
  if (!eventKitSupported()) return unsupportedPermission(entity)
  try {
    return await callMacEventKitNativeAddon<NativePermissionResponse>('authorizationStatus', entity)
  } catch (error) {
    return {
      entity,
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 供设置页展示；不可用时不抛出，避免非 macOS 用户看到 IPC 错误。 */
export async function getPlanningNativeSyncStatus(): Promise<PlanningNativeSyncStatus> {
  if (!eventKitSupported()) return { supported: false, calendar: unsupportedPermission('calendar'), reminder: unsupportedPermission('reminder') }
  const [calendar, reminder] = await Promise.all([getPermission('calendar'), getPermission('reminder')])
  return { supported: true, calendar, reminder }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function requestPlanningNativeSyncAccess(entity: PlanningNativeSyncEntity): Promise<NativePermissionResponse> {
  if (!eventKitSupported()) return unsupportedPermission(entity)
  try {
    // EventKit/TCC 在少数 macOS 版本中会既不展示 sheet 也不调用 completion；绝不能让 UI 无限 loading。
    return await withTimeout(
      callMacEventKitNativeAddon<NativePermissionResponse>('requestAccess', entity),
      12_000,
      '系统授权请求未响应。请在系统设置中手动授予完整访问权限。',
    )
  } catch (error) {
    return {
      entity,
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 仅在已完整授权时返回可写目标；此处不自动触发系统授权弹窗。 */
export async function listPlanningNativeSyncTargets(entity: PlanningNativeSyncEntity): Promise<PlanningNativeSyncTarget[]> {
  if (!eventKitSupported()) return []
  const permission = await getPermission(entity)
  if (permission.status !== 'full-access') return []
  try {
    return await callMacEventKitNativeAddon<PlanningNativeSyncTarget[]>('listWritableTargets', entity)
  } catch {
    return []
  }
}

/** 用户可以显式连接只读集合以浏览；写入能力随 EventKit 目标一并返回。 */
export async function listPlanningNativeConnectionTargets(entity: PlanningNativeSyncEntity): Promise<PlanningNativeSyncTarget[]> {
  if (!eventKitSupported()) return []
  const permission = await getPermission(entity)
  if (permission.status !== 'full-access') return []
  try { return await callMacEventKitNativeAddon<PlanningNativeSyncTarget[]>('listTargets', entity) } catch { return [] }
}

export interface PlanningNativeSyncItem {
  targetId: string
  /** Proma UUID；仅用于新建项目的 crash-recovery marker，不覆盖用户已有 URL。 */
  identity: string
  calendarItemIdentifier?: string
  /** 仅用户在冲突中明确选择“保留 Proma”后才允许 locator 缺失时重建。 */
  allowRecreate?: boolean
  title: string
  notes?: string
  startAt?: number
  endAt?: number
  allDay?: boolean
  dueAt?: number
  dueDateOnly?: boolean
  priority?: 'low' | 'medium' | 'high'
  completed?: boolean
  completedAt?: number
}

export interface PlanningNativeExternalItem {
  calendarItemIdentifier: string
  calendarItemExternalIdentifier?: string
  title: string
  notes?: string
  startAt?: number
  endAt?: number
  allDay?: boolean
  dueAt?: number
  priority?: 'low' | 'medium' | 'high'
  completed?: boolean
  completedAt?: number
  dueDateOnly?: boolean
  isRecurring?: boolean
  lastModifiedAt: number
}

export interface PlanningNativeSyncIdentifiers {
  calendarItemIdentifier?: string
  calendarItemExternalIdentifier?: string
}

export async function listPlanningNativeConnectionItems(entity: PlanningNativeSyncEntity, targetId: string, range?: { from: number; to: number }): Promise<PlanningNativeExternalItem[]> {
  if (!eventKitSupported()) return []
  const permission = await getPermission(entity)
  if (permission.status !== 'full-access') return []
  return callMacEventKitNativeAddon<PlanningNativeExternalItem[]>('listItems', entity, { targetId, ...range })
}

/** 按 Proma 已保存 locator 精确确认删除，不把有界 Calendar 查询误判成完整快照。 */
export async function listPlanningNativeConnectionItemsByIdentifier(entity: PlanningNativeSyncEntity, targetId: string, calendarItemIdentifiers: string[]): Promise<PlanningNativeExternalItem[]> {
  if (calendarItemIdentifiers.length === 0 || !eventKitSupported()) return []
  const permission = await getPermission(entity)
  if (permission.status !== 'full-access') return []
  return callMacEventKitNativeAddon<PlanningNativeExternalItem[]>('listItems', entity, { targetId, calendarItemIdentifiers })
}

/** EventKit 全局变更只触发协调器重新读取已连接目标，绝不借此扫描其它系统集合。 */
export function subscribePlanningNativeSyncChanges(listener: () => void): boolean {
  if (!eventKitSupported()) return false
  try { return subscribeMacEventKitNativeChanges(listener) } catch { return false }
}

export async function upsertPlanningNativeSyncItem(entity: PlanningNativeSyncEntity, item: PlanningNativeSyncItem): Promise<PlanningNativeSyncIdentifiers> {
  if (!eventKitSupported()) throw new Error('macOS 14 或更高版本才支持系统日历与提醒事项同步')
  return callMacEventKitNativeAddon<PlanningNativeSyncIdentifiers>('upsert', entity, item)
}

/** 删除必须带受管目标和 Proma marker；locator 缺失时 native addon 可恢复定位，避免崩溃留下孤儿项。 */
export async function removePlanningNativeSyncItem(entity: PlanningNativeSyncEntity, item: Pick<PlanningNativeSyncItem, 'targetId' | 'identity' | 'calendarItemIdentifier' | 'startAt'>): Promise<void> {
  if (!eventKitSupported()) return
  await callMacEventKitNativeAddon<Record<string, never>>('remove', entity, item)
}
