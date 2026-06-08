/**
 * 定时任务完成通知投递服务。
 *
 * 当前仅实现飞书目标；钉钉/微信后续接入时复用同一入口。
 */

import type {
  Automation,
  AutomationRun,
} from '@proma/shared'
import { getAgentSessionSDKMessages } from './agent-session-manager'
import { feishuBridgeManager } from './feishu-bridge-manager'
import {
  buildAutomationFeishuCard,
  extractAssistantText,
  shouldNotifyAutomationTarget,
} from './automation-notification-format'

interface AutomationNotificationPayload {
  automation: Automation
  run: AutomationRun
}

export async function notifyAutomationRunFinished(payload: AutomationNotificationPayload): Promise<void> {
  const targets = payload.automation.notificationTargets ?? []
  if (targets.length === 0) return

  for (const target of targets) {
    if (!shouldNotifyAutomationTarget(target, payload.run.status)) continue

    if (target.type === 'feishu') {
      try {
        const summary = payload.run.status === 'success'
          ? extractAssistantText(getAgentSessionSDKMessages(payload.run.sessionId))
          : (payload.run.error ?? '未知错误')
        await feishuBridgeManager.sendCardToChat(
          target.botId,
          target.chatId,
          buildAutomationFeishuCard({ ...payload, summary }),
        )
      } catch (error) {
        console.error(`[定时任务] 飞书通知发送失败: automation=${payload.automation.id}, chat=${target.chatId}`, error)
      }
    }
  }
}
