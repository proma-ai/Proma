/**
 * 定时任务（Automation）调度器
 *
 * 核心设计（见 .context/plan/automation-feature.md）：
 * - 用「下次触发时间戳 + 短 tick 轮询」而非长 setInterval，避免系统休眠导致的定时器漂移
 * - 每轮触发都新建独立子会话执行，不复用来源会话（规避 orchestrator 同会话并发守卫 + 防上下文膨胀）
 * - 强制 bypassPermissions，否则无人值守时写操作会因权限弹窗永久阻塞
 * - 来源会话/目标会话忙时跳过本轮，不排队堆积
 * - 连续失败达上限自动暂停
 * - 启动时恢复：已过期的 nextRunAt 顺延到下一个完整间隔，避免重启雪崩触发
 */

import { BrowserWindow } from 'electron'
import {
  AUTOMATION_MAX_CONSECUTIVE_FAILURES,
  AUTOMATION_IPC_CHANNELS,
  AUTOMATION_DEFAULT_SESSION_MODE,
  type Automation,
  type AutomationRun,
} from '@proma/shared'
import {
  listAutomations,
  getAutomation,
  appendRun,
  updateAutomation,
  setNextRunAt,
  setLastSessionId,
  computeNextRunAt,
} from './automation-manager'
import { createAgentSession, updateAgentSessionMeta, getAgentSessionMeta } from './agent-session-manager'
import { runAgentHeadless, isAgentSessionActive } from './agent-service'
import { notifyAutomationRunFinished } from './automation-notification-service'

/** tick 周期：每 30s 检查一次到期任务（短轮询，抗休眠漂移） */
const TICK_INTERVAL_MS = 30_000

/** 单次任务执行的超时上限：2 小时。超时后强制标记为 error 并释放 runningAutomations 槽位 */
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000

function formatScheduleLabel(a: Automation): string {
  if (a.scheduleType === 'daily') return `每天 ${a.timeOfDay ?? '09:00'}`
  if (a.scheduleType === 'weekly') {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `每${names[a.dayOfWeek ?? 1]} ${a.timeOfDay ?? '09:00'}`
  }
  if (a.scheduleType === 'monthly') return `每月 ${a.dayOfMonth ?? 1} 号 ${a.timeOfDay ?? '09:00'}`
  const min = a.intervalMinutes
  if (min < 60) return `每 ${min} 分钟`
  if (min < 1440) return `每 ${min / 60} 小时`
  return `每 ${min / 1440} 天`
}

let tickTimer: NodeJS.Timeout | undefined
/** 正在执行中的 automation id 集合，防止同一任务重入 */
const runningAutomations = new Set<string>()

/** 向所有渲染窗口广播任务列表变更，触发前端刷新 */
export function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(AUTOMATION_IPC_CHANNELS.CHANGED)
    }
  }
}

/**
 * 执行一次定时任务：新建子会话 + headless 运行
 *
 * @param automation 任务定义
 * @param manual 是否手动「立即运行」（手动运行也走同一路径，但不影响调度计时由 appendRun 统一推进）
 */
export async function runAutomation(automation: Automation, manual = false): Promise<void> {
  if (runningAutomations.has(automation.id)) {
    console.log(`[定时任务] ${automation.name} 上一轮尚未结束，跳过本轮`)
    appendRun(automation.id, {
      runAt: Date.now(),
      sessionId: '',
      status: 'skipped',
      skipReason: '上一轮尚未结束',
    })
    broadcastChanged()
    return
  }

  runningAutomations.add(automation.id)
  const runAt = Date.now()

  try {
    // 根据 sessionMode 决定新建或复用子会话
    const sessionMode = automation.sessionMode ?? AUTOMATION_DEFAULT_SESSION_MODE
    const reuseSessionId = sessionMode === 'reuse' && automation.lastSessionId
      ? (getAgentSessionMeta(automation.lastSessionId) ? automation.lastSessionId : undefined)
      : undefined

    let targetSessionId: string
    if (reuseSessionId) {
      targetSessionId = reuseSessionId
    } else {
      const created = createAgentSession(automation.name, automation.channelId, automation.workspaceId)
      updateAgentSessionMeta(created.id, { sourceAutomationId: automation.id })
      targetSessionId = created.id
      setLastSessionId(automation.id, created.id)
    }

    await new Promise<void>((resolveRun) => {
      let settled = false
      const finish = (status: 'success' | 'error', error?: string): void => {
        if (settled) return
        settled = true
        if (timeoutTimer) clearTimeout(timeoutTimer)
        const run: AutomationRun = {
          runAt,
          sessionId: targetSessionId,
          status,
          durationMs: Date.now() - runAt,
          error,
        }
        appendRun(automation.id, run)
        broadcastChanged()
        void notifyAutomationRunFinished({ automation, run }).catch((err) => {
          console.error(`[定时任务] 发送完成通知失败: ${automation.name}`, err)
        })
        // 失败退避：连续失败达上限自动暂停
        const latest = getAutomation(automation.id)
        if (
          latest &&
          latest.active &&
          (latest.consecutiveFailures ?? 0) >= AUTOMATION_MAX_CONSECUTIVE_FAILURES
        ) {
          updateAutomation({ id: automation.id, active: false })
          console.warn(`[定时任务] ${automation.name} 连续失败 ${latest.consecutiveFailures} 次，已自动暂停`)
          broadcastChanged()
        }
        resolveRun()
      }

      // 超时保护：防止 runAgentHeadless 永远不回调导致 automation 永久卡死
      const timeoutTimer = setTimeout(() => {
        finish('error', `执行超时（超过 ${RUN_TIMEOUT_MS / 3600_000} 小时）`)
        console.warn(`[定时任务] ${automation.name} 执行超时，强制结束`)
      }, RUN_TIMEOUT_MS)

      runAgentHeadless(
        {
          sessionId: targetSessionId,
          userMessage: automation.prompt + '\n<!--PROMA_SCHEDULED_RUN-->',
          automationContext: `这是 Proma 定时任务「${automation.name}」的自动执行（ID: ${automation.id}，${formatScheduleLabel(automation)}）。这本身就是定时任务，不要建议用户再创建定时任务。直接执行任务即可。如发现本任务连续失败、输出价值低、频率不合适或提示词不完整，可以使用 automation 工具读取并更新当前任务。`,
          channelId: automation.channelId,
          modelId: automation.modelId,
          workspaceId: automation.workspaceId,
          permissionModeOverride: automation.permissionMode ?? 'bypassPermissions',
          triggeredBy: 'automation',
          startedAt: runAt,
        },
        {
          source: 'bridge',
          onError: (error) => finish('error', error),
          onComplete: () => finish('success'),
          onTitleUpdated: () => { /* 子会话标题不需要特殊处理 */ },
        },
      ).catch((err) => {
        finish('error', err instanceof Error ? err.message : '未知错误')
      })
    })
  } catch (err) {
    console.error(`[定时任务] ${automation.name} 执行异常:`, err)
    const run: AutomationRun = {
      runAt,
      sessionId: '',
      status: 'error',
      durationMs: Date.now() - runAt,
      error: err instanceof Error ? err.message : '未知错误',
    }
    appendRun(automation.id, run)
    broadcastChanged()
    void notifyAutomationRunFinished({ automation, run }).catch((notifyError) => {
      console.error(`[定时任务] 发送异常通知失败: ${automation.name}`, notifyError)
    })
  } finally {
    runningAutomations.delete(automation.id)
  }
}

/** 立即运行一次（手动触发，不影响调度计时之外的逻辑） */
export async function runAutomationNow(id: string): Promise<void> {
  const automation = getAutomation(id)
  if (!automation) throw new Error(`定时任务不存在: ${id}`)
  await runAutomation(automation, true)
}

/** 一个 tick：扫描所有 active 且到期的任务并触发 */
function tick(): void {
  const now = Date.now()
  for (const automation of listAutomations()) {
    if (!automation.active) continue
    if (now < automation.nextRunAt) continue
    if (runningAutomations.has(automation.id)) continue
    // 来源会话忙时跳过（极端情况下的额外保险，主要靠新建子会话规避）
    if (automation.sourceSessionId && isAgentSessionActive(automation.sourceSessionId)) {
      continue
    }
    // 不 await，让多个任务可以并行触发；各自有 runningAutomations 重入保护
    void runAutomation(automation)
  }
}

/**
 * 启动调度器
 *
 * 恢复策略：把已过期的 nextRunAt 顺延到「现在 + 一个完整间隔」，
 * 避免应用重启后一堆历史任务在同一 tick 内雪崩触发。
 */
export function startScheduler(): void {
  if (tickTimer) return
  const now = Date.now()
  for (const automation of listAutomations()) {
    if (automation.active && automation.nextRunAt <= now) {
      setNextRunAt(automation.id, computeNextRunAt(automation, now))
    }
  }
  tickTimer = setInterval(tick, TICK_INTERVAL_MS)
  console.log(`[定时任务] 调度器已启动，tick 周期 ${TICK_INTERVAL_MS / 1000}s`)
}

/** 停止调度器（before-quit 调用） */
export function stopScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = undefined
    console.log('[定时任务] 调度器已停止')
  }
}
