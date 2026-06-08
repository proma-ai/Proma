/**
 * 定时任务通知的纯格式化逻辑。
 */

import type {
  Automation,
  AutomationNotificationTarget,
  AutomationRun,
  SDKAssistantMessage,
  SDKMessage,
} from '@proma/shared'

interface AutomationNotificationCardPayload {
  automation: Automation
  run: AutomationRun
  summary: string
}

export function shouldNotifyAutomationTarget(
  target: AutomationNotificationTarget,
  status: AutomationRun['status'],
): boolean {
  if (!target.enabled) return false
  if (status === 'skipped') return false
  if (target.trigger === 'always') return true
  return target.trigger === status
}

export function extractAssistantText(messages: SDKMessage[]): string {
  const chunks: string[] = []

  for (const msg of messages) {
    if (msg.type !== 'assistant') continue
    const assistant = msg as SDKAssistantMessage
    for (const block of assistant.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        chunks.push(block.text)
      }
    }
  }

  return chunks.join('\n\n').trim()
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '未知'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`
  return `${Math.round(ms / 60_000)} 分钟`
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n\n... [内容过长，请在 Proma 中查看完整会话]`
}

export function buildAutomationFeishuCard(payload: AutomationNotificationCardPayload): Record<string, unknown> {
  const { automation, run } = payload
  const success = run.status === 'success'
  const title = success ? '定时任务已完成' : '定时任务失败'
  const template = success ? 'green' : 'red'
  const statusLine = success ? '完成' : '失败'
  const fallback = success ? 'Agent 已完成（无文本输出）' : '没有错误详情'

  const lines = [
    `**任务**: ${automation.name}`,
    `**状态**: ${statusLine}`,
    `**耗时**: ${formatDuration(run.durationMs)}`,
    run.sessionId ? `**会话 ID**: ${run.sessionId}` : '',
    '',
    truncate(payload.summary.trim() || fallback, 12000),
  ].filter(Boolean)

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template,
    },
    elements: [
      {
        tag: 'markdown',
        content: lines.join('\n'),
      },
    ],
  }
}
