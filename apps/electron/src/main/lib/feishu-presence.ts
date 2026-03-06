/**
 * 飞书在场检测服务
 *
 * 接收渲染进程上报的用户活动状态，结合窗口状态和系统空闲时间，
 * 判断用户是否正在「关注」某个会话。
 *
 * 在场 = 不需要发飞书通知；离开 = 需要发飞书通知。
 */

import { BrowserWindow, powerMonitor } from 'electron'
import type { FeishuPresenceReport } from '@proma/shared'

/** 内部在场状态 */
interface PresenceState {
  /** 当前查看的会话 ID */
  activeSessionId: string | null
  /** 最后交互时间 */
  lastInteractionAt: number
}

/** 系统空闲超时（秒） */
const SYSTEM_IDLE_TIMEOUT = 120
/** 窗口失焦超时（毫秒） */
const FOCUS_LOST_TIMEOUT = 30_000

class PresenceService {
  private state: PresenceState = {
    activeSessionId: null,
    lastInteractionAt: Date.now(),
  }

  /** 更新在场状态（渲染进程上报） */
  updatePresence(report: FeishuPresenceReport): void {
    this.state.activeSessionId = report.activeSessionId
    this.state.lastInteractionAt = report.lastInteractionAt
  }

  /**
   * 判断用户是否「在场」观察某个会话
   *
   * 不在场的条件（任一满足）：
   * - 窗口最小化
   * - 窗口失焦超过 30 秒
   * - 系统空闲超过 2 分钟
   * - 当前查看的不是这个会话（后台会话）
   */
  isUserPresent(sessionId: string): boolean {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) return false

    // 窗口最小化 → 不在场
    if (win.isMinimized()) return false

    // 窗口失焦超过 30 秒 → 不在场
    if (!win.isFocused() && Date.now() - this.state.lastInteractionAt > FOCUS_LOST_TIMEOUT) {
      return false
    }

    // 系统空闲超过 2 分钟 → 不在场
    try {
      if (powerMonitor.getSystemIdleTime() > SYSTEM_IDLE_TIMEOUT) return false
    } catch {
      // powerMonitor 可能在某些环境下不可用
    }

    // 当前查看的不是这个会话 → 不在场
    if (this.state.activeSessionId !== sessionId) return false

    return true
  }
}

export const presenceService = new PresenceService()
