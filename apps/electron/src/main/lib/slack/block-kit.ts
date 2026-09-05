import type { AskUserRequest, ExitPlanModeRequest, PermissionRequest } from '@proma/shared'

export type SlackBlock = Record<string, unknown>

const MAX_BLOCKS = 50
const MAX_SECTION_TEXT = 3000
const MAX_FALLBACK_TEXT = 40_000

function splitAtBoundary(text: string, maxLength: number): [string, string] {
  if (text.length <= maxLength) return [text, '']
  const prefix = text.slice(0, maxLength)
  const boundary = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf(' '))
  const at = boundary > Math.floor(maxLength * 0.55) ? boundary + 1 : maxLength
  return [text.slice(0, at), text.slice(at)]
}

/** Slack mrkdwn is intentionally small: preserve safe Markdown and normalize unsupported tables. */
export function toSlackMrkdwn(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/^\|(.+\|)\n\|(?:\s*:?-+:?\s*\|)+\s*$/gm, (_all, header: string) => `\`${header.trim()}\``)
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')
    .replace(/__(.+?)__/gs, '_$1_')
}

export interface SlackRenderedMessage {
  text: string
  blocks: SlackBlock[]
  truncated: boolean
}

/** Build readable blocks with a mandatory plain-text fallback and Slack size limits. */
export function renderSlackMessage(markdown: string): SlackRenderedMessage {
  const text = toSlackMrkdwn(markdown).trim() || '（未返回文本内容）'
  const fallback = text.slice(0, MAX_FALLBACK_TEXT)
  let rest = text
  const blocks: SlackBlock[] = []

  while (rest && blocks.length < MAX_BLOCKS) {
    const [part, remainder] = splitAtBoundary(rest, MAX_SECTION_TEXT)
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: part } })
    rest = remainder
  }

  const truncated = rest.length > 0
  if (truncated && blocks.length > 0) {
    blocks[blocks.length - 1] = {
      type: 'section',
      text: { type: 'mrkdwn', text: '内容过长，已截断。请在 Proma 桌面端查看完整会话。' },
    }
  }
  return { text: fallback, blocks, truncated }
}

function actionValue(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

function questionSelect(request: AskUserRequest, questionIndex: number): SlackBlock {
  const question = request.questions[questionIndex]!
  const select = question.multiSelect ? 'multi_static_select' : 'static_select'
  return {
    type: 'actions',
    block_id: `proma-ask-${request.requestId}-${questionIndex}`,
    elements: [{
      type: select,
      action_id: 'proma_ask_select',
      placeholder: { type: 'plain_text', text: question.multiSelect ? '选择一个或多个选项' : '选择一个选项' },
      options: question.options.slice(0, 100).map((option) => ({
        text: { type: 'plain_text', text: option.label.slice(0, 75) },
        value: actionValue({ requestId: request.requestId, questionIndex, label: option.label }),
        ...(option.description ? { description: { type: 'plain_text', text: option.description.slice(0, 75) } } : {}),
      })),
    }],
  }
}

/** Build a single interactive message for AskUserQuestion. */
export function buildAskUserBlocks(request: AskUserRequest): SlackRenderedMessage {
  const blocks: SlackBlock[] = [{
    type: 'header', text: { type: 'plain_text', text: 'Proma 需要你的选择' },
  }]

  request.questions.slice(0, 20).forEach((question, index) => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${question.header ?? `问题 ${index + 1}`}*\n${question.question}`.slice(0, MAX_SECTION_TEXT) },
    })
    if (question.options.length > 0) {
      blocks.push(questionSelect(request, index))
      if (question.multiSelect) {
        blocks.push({
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: '确认多选' },
            style: 'primary',
            action_id: 'proma_ask_submit',
            value: actionValue({ requestId: request.requestId, questionIndex: index }),
          }],
        })
      }
    } else {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '请直接在线程中回复你的答案。' }] })
    }
  })
  if (request.questions.length > 20) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '问题过多，已仅显示前 20 项。' }] })
  }
  return { text: 'Proma 正在等待你的回答。', blocks: blocks.slice(0, MAX_BLOCKS), truncated: false }
}

export function buildPlanApprovalBlocks(request: ExitPlanModeRequest): SlackRenderedMessage {
  const items = request.allowedPrompts.length
    ? request.allowedPrompts.map((item) => `• *${item.tool}* — ${item.prompt}`).join('\n')
    : 'Agent 未提供明确的操作清单。'
  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Proma 请求批准并自动执行' } },
    { type: 'section', text: { type: 'mrkdwn', text: items.slice(0, MAX_SECTION_TEXT) } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '批准会让*当前运行*退出计划模式并自动执行后续工具调用；如不希望授予本轮自动执行权限，请拒绝并在 Proma 桌面端继续。' }] },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '批准并自动执行本轮' }, style: 'primary', action_id: 'proma_plan_approve', value: actionValue({ requestId: request.requestId }) },
        { type: 'button', text: { type: 'plain_text', text: '拒绝' }, style: 'danger', action_id: 'proma_plan_deny', value: actionValue({ requestId: request.requestId }) },
      ],
    },
  ]
  return { text: `Proma 请求批准并自动执行本轮计划：${request.allowedPrompts.length} 项操作。`, blocks, truncated: false }
}

export function buildPermissionBlocks(request: PermissionRequest): SlackRenderedMessage {
  const detail = [request.description, request.command ? `\`${request.command}\`` : undefined]
    .filter(Boolean).join('\n')
  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Proma 请求单次授权' } },
    { type: 'section', text: { type: 'mrkdwn', text: detail.slice(0, MAX_SECTION_TEXT) } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '此卡片不会提供“始终允许”。只有明确点击计划卡的“批准并自动执行本轮”才会授予该运行的自动执行权限。' }] },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '允许一次' }, style: 'primary', action_id: 'proma_permission_allow', value: actionValue({ requestId: request.requestId }) },
        { type: 'button', text: { type: 'plain_text', text: '拒绝' }, style: 'danger', action_id: 'proma_permission_deny', value: actionValue({ requestId: request.requestId }) },
      ],
    },
  ]
  return { text: `Proma 请求授权：${request.description}`, blocks, truncated: false }
}
