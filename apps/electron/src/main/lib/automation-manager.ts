/**
 * 定时任务（Automation）管理器
 *
 * 负责定时任务的 CRUD 与运行历史持久化。
 * - 索引文件：~/.proma/automations.json
 *
 * 照搬 agent-session-manager.ts 的原子写模式（safe-file）。
 * 调度逻辑见 automation-scheduler.ts，本文件只管数据。
 */

import { randomUUID } from 'node:crypto'
import { writeJsonFileAtomic, readJsonFileSafe } from './safe-file'
import { getAutomationsPath } from './config-paths'
import {
  AUTOMATION_MAX_HISTORY,
  AUTOMATION_DEFAULT_PERMISSION_MODE,
  type Automation,
  type AutomationRun,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '@proma/shared'

/** 索引文件格式 */
interface AutomationsIndex {
  version: number
  automations: Automation[]
}

const INDEX_VERSION = 2

/**
 * 兼容历史 sessionMode 字面量：v1 用过的 'new' 值统一改为 'daily'。
 * - v1 默认值 'new' 的语义是「每次新建会话」；v2 的 'daily' 默认行为是「同日复用、跨日新建」，
 *   高频任务可少占左侧栏 tab，低频任务（间隔 ≥ 24h）的实际行为等价于「每次新建」，对用户无负面影响。
 * - 同时把 index.version bump 到当前值，避免下次启动反复迁移。
 * 返回是否发生改动，由调用方决定是否写回磁盘。
 */
function migrateLegacySessionMode(data: AutomationsIndex): boolean {
  let changed = false
  for (const a of data.automations) {
    if ((a.sessionMode as string | undefined) === 'new') {
      a.sessionMode = 'daily'
      changed = true
    }
  }
  if (data.version < INDEX_VERSION) {
    data.version = INDEX_VERSION
    changed = true
  }
  return changed
}

/**
 * 内存缓存：避免每次操作都从磁盘读取完整索引。
 * 所有写入操作同时更新缓存和磁盘（write-through），保证一致性。
 * 由于 readFileSync/writeFileSync 是同步的，Node 事件循环不会在 read-modify-write 中间让出，
 * 因此不存在并发竞态。缓存的作用是减少冗余磁盘 I/O。
 */
let cachedIndex: AutomationsIndex | null = null

function readIndex(): AutomationsIndex {
  if (cachedIndex) return cachedIndex

  const data = readJsonFileSafe<AutomationsIndex>(getAutomationsPath())
  if (!data) {
    cachedIndex = { version: INDEX_VERSION, automations: [] }
    return cachedIndex
  }
  if (typeof data.version !== 'number') {
    console.warn(`[定时任务] 索引文件缺少有效 version 字段，将忽略其内容`)
    cachedIndex = { version: INDEX_VERSION, automations: [] }
    return cachedIndex
  }
  if (data.version > INDEX_VERSION) {
    // 数据由更高版本的 Proma 写入（用户回滚到旧版的场景）。保留原始 automations 数组只读返回，
    // 避免下次 writeIndex 用空数据覆盖磁盘导致永久丢失任务配置和运行历史。
    console.warn(
      `[定时任务] 索引文件版本 ${data.version} 高于当前构建（${INDEX_VERSION}），将以原数据加载，` +
        `可能存在不识别的字段；请尽量升级到最新版本。`,
    )
    if (!Array.isArray(data.automations)) {
      cachedIndex = { version: INDEX_VERSION, automations: [] }
      return cachedIndex
    }
    cachedIndex = data
    return cachedIndex
  }
  if (!Array.isArray(data.automations)) {
    cachedIndex = { version: INDEX_VERSION, automations: [] }
    return cachedIndex
  }
  const migrated = migrateLegacySessionMode(data)
  cachedIndex = data
  if (migrated) {
    writeIndex(data)
    console.log('[定时任务] 索引已迁移至最新版本（sessionMode: new → daily）')
  }
  return cachedIndex
}

function writeIndex(index: AutomationsIndex): void {
  try {
    cachedIndex = index
    writeJsonFileAtomic(getAutomationsPath(), index)
  } catch (error) {
    cachedIndex = null // 写入失败时丢弃缓存，下次重新从磁盘读取
    console.error('[定时任务] 写入索引文件失败:', error)
    throw new Error('写入定时任务索引失败')
  }
}

/**
 * 计算下次触发时间戳（从基准时刻 from 起算）
 * - interval：from + 间隔分钟
 * - daily：今天/明天的 timeOfDay
 * - weekly：本周/下周 dayOfWeek 的 timeOfDay
 *
 * 返回值保证为有限正整数。输入非法时回退到 from + 10min 并打印警告。
 */
export function computeNextRunAt(
  a: { scheduleType: Automation['scheduleType'] } & Partial<
    Pick<Automation, 'intervalMinutes' | 'timeOfDay' | 'dayOfWeek' | 'dayOfMonth'>
  >,
  from: number = Date.now(),
): number {
  const FALLBACK_INTERVAL_MS = 10 * 60_000

  let result: number

  if (a.scheduleType === 'interval') {
    const minutes = Number(a.intervalMinutes)
    if (!Number.isFinite(minutes) || minutes < 1) {
      console.warn(`[定时任务] computeNextRunAt: intervalMinutes 非法 (${a.intervalMinutes})，回退到 10 分钟`)
      result = from + FALLBACK_INTERVAL_MS
    } else {
      result = from + Math.max(1, minutes) * 60_000
    }
  } else {
    const timeOfDay = a.timeOfDay ?? '09:00'
    const parts = timeOfDay.split(':').map(Number)
    const hh = Number.isFinite(parts[0]) ? parts[0]! : 9
    const mm = Number.isFinite(parts[1]) ? parts[1]! : 0
    const next = new Date(from)
    next.setSeconds(0, 0)
    next.setHours(hh, mm, 0, 0)

    if (a.scheduleType === 'daily') {
      if (next.getTime() <= from) next.setDate(next.getDate() + 1)
      result = next.getTime()
    } else if (a.scheduleType === 'monthly') {
      const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
      const targetDom = Number.isFinite(a.dayOfMonth) && a.dayOfMonth! >= 1 && a.dayOfMonth! <= 31
        ? a.dayOfMonth!
        : 1
      // 先重置到当月 1 号再设日，避免当前日期为 31 时进入短月自动溢出（如 3/31 setMonth(3) 会变 5/1）
      next.setDate(1)
      next.setDate(Math.min(targetDom, daysInMonth(next.getFullYear(), next.getMonth())))
      if (next.getTime() <= from) {
        // 关键：先回到当月 1 号再 +1 月，否则若当前 getDate() 已落在该月最后一天（targetDom 被钳到 30/28），
        // setMonth 仍会越过短月（如 1/31 → 3/3）。setDate(1) 后再前进月份才是稳定的。
        next.setDate(1)
        next.setMonth(next.getMonth() + 1)
        next.setDate(Math.min(targetDom, daysInMonth(next.getFullYear(), next.getMonth())))
      }
      result = next.getTime()
    } else {
      // weekly
      const targetDow = Number.isFinite(a.dayOfWeek) ? a.dayOfWeek! : 1
      let dayDiff = (targetDow - next.getDay() + 7) % 7
      if (dayDiff === 0 && next.getTime() <= from) dayDiff = 7
      next.setDate(next.getDate() + dayDiff)
      result = next.getTime()
    }
  }

  if (!Number.isFinite(result) || result <= 0) {
    console.warn(`[定时任务] computeNextRunAt: 计算结果非法 (${result})，回退到 10 分钟后`)
    return from + FALLBACK_INTERVAL_MS
  }

  return result
}

/** 获取全部定时任务（按 createdAt 升序，保持列表稳定） */
export function listAutomations(): Automation[] {
  return readIndex().automations.sort((a, b) => a.createdAt - b.createdAt)
}

/** 按 ID 获取单个定时任务 */
export function getAutomation(id: string): Automation | undefined {
  return readIndex().automations.find((a) => a.id === id)
}

/** 任务是否具备运行所需的最小完整度（channelId + workspaceId） */
function isAutomationRunnable(a: Pick<Automation, 'channelId' | 'workspaceId'>): boolean {
  return !!a.channelId && !!a.workspaceId
}

/** 创建定时任务 */
export function createAutomation(input: CreateAutomationInput): Automation {
  const index = readIndex()
  const now = Date.now()
  // 草稿态（缺 channelId / workspaceId）强制不启用，避免空配置任务进入调度
  const requestedActive = input.active ?? true
  const active = requestedActive && isAutomationRunnable(input)

  const automation: Automation = {
    id: randomUUID(),
    name: input.name,
    prompt: input.prompt,
    active,
    scheduleType: input.scheduleType,
    intervalMinutes: input.intervalMinutes,
    timeOfDay: input.timeOfDay,
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
    channelId: input.channelId,
    modelId: input.modelId,
    workspaceId: input.workspaceId,
    permissionMode: input.permissionMode ?? AUTOMATION_DEFAULT_PERMISSION_MODE,
    sessionMode: input.sessionMode,
    notificationTargets: input.notificationTargets,
    sourceSessionId: input.sourceSessionId,
    createdAt: now,
    updatedAt: now,
    nextRunAt: computeNextRunAt(input, now),
    runHistory: [],
  }

  index.automations.push(automation)
  writeIndex(index)
  console.log(`[定时任务] 已创建: ${automation.name} (${automation.id}), 模式 ${automation.scheduleType}`)
  return automation
}

/** 更新定时任务（部分字段） */
export function updateAutomation(input: UpdateAutomationInput): Automation | undefined {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === input.id)
  if (!target) return undefined

  const now = Date.now()
  if (input.name !== undefined) target.name = input.name
  if (input.prompt !== undefined) target.prompt = input.prompt
  if (input.channelId !== undefined) target.channelId = input.channelId
  if (input.modelId !== undefined) target.modelId = input.modelId
  // workspaceId 允许设为空字符串表示「无工作区」；用 undefined 区分「不修改」
  if (input.workspaceId !== undefined) {
    target.workspaceId = input.workspaceId || undefined
  }
  if (input.permissionMode !== undefined) target.permissionMode = input.permissionMode
  if (input.sessionMode !== undefined) target.sessionMode = input.sessionMode
  if (input.notificationTargets !== undefined) target.notificationTargets = input.notificationTargets

  // 调度参数变化：重算下次运行时间（从现在起算，避免旧时间戳立即触发）
  const scheduleChanged =
    (input.scheduleType !== undefined && input.scheduleType !== target.scheduleType) ||
    (input.intervalMinutes !== undefined && input.intervalMinutes !== target.intervalMinutes) ||
    (input.timeOfDay !== undefined && input.timeOfDay !== target.timeOfDay) ||
    (input.dayOfWeek !== undefined && input.dayOfWeek !== target.dayOfWeek) ||
    (input.dayOfMonth !== undefined && input.dayOfMonth !== target.dayOfMonth)
  if (input.scheduleType !== undefined) target.scheduleType = input.scheduleType
  if (input.intervalMinutes !== undefined) target.intervalMinutes = input.intervalMinutes
  if (input.timeOfDay !== undefined) target.timeOfDay = input.timeOfDay
  if (input.dayOfWeek !== undefined) target.dayOfWeek = input.dayOfWeek
  if (input.dayOfMonth !== undefined) target.dayOfMonth = input.dayOfMonth
  if (scheduleChanged) {
    target.nextRunAt = computeNextRunAt(target, now)
  }

  // 启用状态变化
  if (input.active !== undefined && input.active !== target.active) {
    // 启用要求 channelId + workspaceId 齐全，否则拒绝（兜底前端校验，避免空配置任务进入调度）
    if (input.active && !isAutomationRunnable(target)) {
      throw new Error('启用定时任务前必须配置模型与工作区')
    }
    target.active = input.active
    if (input.active) {
      // 重新启用：从现在起算下一次触发，清空连续失败计数
      target.nextRunAt = computeNextRunAt(target, now)
      target.consecutiveFailures = 0
    }
  }

  // 调度配置被改成不完整时自动暂停：防止用户清空工作区 / 渠道后任务仍处于 active 进入 tick
  if (target.active && !isAutomationRunnable(target)) {
    target.active = false
  }

  target.updatedAt = now
  writeIndex(index)
  return target
}

/** 删除定时任务 */
export function deleteAutomation(id: string): boolean {
  const index = readIndex()
  const before = index.automations.length
  index.automations = index.automations.filter((a) => a.id !== id)
  if (index.automations.length === before) return false
  writeIndex(index)
  console.log(`[定时任务] 已删除: ${id}`)
  return true
}

/**
 * 记录一次运行结果并推进下次触发时间
 *
 * 由调度器在运行完成/失败/跳过后调用。
 * - 成功/失败：从「现在」起算下次触发时间
 * - 跳过：不动 nextRunAt——否则任务因重入持续跳过时，每次跳过都会把下次触发再推一个完整间隔，
 *   实际周期会被拉成 N×interval。保留原 nextRunAt 让下一个 tick 立刻有机会再次尝试。
 * - 成功/跳过：清零连续失败计数；失败：累加（调度器据此判断是否自动暂停）
 */
export function appendRun(id: string, run: AutomationRun): Automation | undefined {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === id)
  if (!target) return undefined

  const now = Date.now()
  target.runHistory.unshift(run)
  if (target.runHistory.length > AUTOMATION_MAX_HISTORY) {
    target.runHistory = target.runHistory.slice(0, AUTOMATION_MAX_HISTORY)
  }

  if (run.status !== 'skipped') {
    target.lastRunAt = run.runAt
    target.nextRunAt = computeNextRunAt(target, now)
  }

  if (run.status === 'error') {
    target.consecutiveFailures = (target.consecutiveFailures ?? 0) + 1
  } else {
    target.consecutiveFailures = 0
  }

  target.updatedAt = now
  writeIndex(index)
  return target
}

/** 设置 nextRunAt（调度器恢复过期任务时用，避免重启雪崩触发） */
export function setNextRunAt(id: string, nextRunAt: number): void {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === id)
  if (!target) return
  target.nextRunAt = nextRunAt
  writeIndex(index)
}

/** 记录本任务最近一次运行创建的会话 ID */
export function setLastSessionId(id: string, sessionId: string): void {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === id)
  if (!target) return
  target.lastSessionId = sessionId
  writeIndex(index)
}
