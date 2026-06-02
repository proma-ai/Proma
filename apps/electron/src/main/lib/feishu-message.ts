/**
 * 飞书消息格式化
 *
 * 将 Agent 事件转换为飞书消息卡片格式。
 */

// Phase 1: AgentEvent 不再使用，保留 import 供后续清理

/** 工具活动摘要 */
export interface ToolSummary {
  toolName: string
  count: number
  hasError: boolean
}

/** Agent 完成后的格式化结果 */
export interface FormattedAgentResult {
  text: string
  toolSummaries: ToolSummary[]
  duration: number
}

/**
 * 构建 Agent 回复的飞书交互卡片
 */
export function buildAgentReplyCard(result: FormattedAgentResult, subtitle?: string): Record<string, unknown> {
  const toolLine = formatToolSummaryLine(result.toolSummaries, result.duration)
  const content = truncateForFeishu(result.text)

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Proma Agent' },
      ...(subtitle ? { subtitle: { tag: 'plain_text', content: subtitle } } : {}),
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content },
      ...(toolLine ? [
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: toolLine }],
        },
      ] : []),
    ],
  }
}

/**
 * 构建错误卡片
 */
export function buildErrorCard(errorMessage: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Proma 错误' },
      template: 'red',
    },
    elements: [
      { tag: 'markdown', content: errorMessage },
    ],
  }
}

/** 工作区及其会话的列表项 */
export interface WorkspaceListItem {
  id: string
  name: string
  sessions: Array<{ id: string; title: string; active: boolean; index: number }>
}

/**
 * 构建会话列表卡片（/list 命令）
 *
 * 按工作区分组展示，每个工作区下显示最近会话。
 */
export function buildSessionListCard(
  workspaces: WorkspaceListItem[],
  currentWorkspaceId?: string,
): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = []

  for (const ws of workspaces) {
    const isCurrent = ws.id === currentWorkspaceId
    const wsLabel = isCurrent ? `**${ws.name}**（当前）` : ws.name

    if (ws.sessions.length === 0) {
      elements.push({
        tag: 'markdown',
        content: `${wsLabel}\n  暂无会话`,
      })
    } else {
      const lines = ws.sessions.map((s) => {
        const prefix = s.active ? '▶ ' : '  '
        return `${prefix}**${s.index}.** ${s.title}`
      })
      elements.push({
        tag: 'markdown',
        content: `${wsLabel}\n${lines.join('\n')}`,
      })
    }
  }

  if (elements.length === 0) {
    elements.push({ tag: 'markdown', content: '暂无工作区和会话' })
  }

  // 用分割线隔开每个工作区
  const withDividers: Array<Record<string, unknown>> = []
  for (let i = 0; i < elements.length; i++) {
    if (i > 0) withDividers.push({ tag: 'hr' })
    withDividers.push(elements[i]!)
  }

  // 底部提示
  withDividers.push({ tag: 'hr' })
  withDividers.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: '使用 /switch <序号> 切换会话 | /new 创建新会话' }],
  })

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '工作区与会话' },
      template: 'blue',
    },
    elements: withDividers,
  }
}

/**
 * 构建工作区切换结果卡片（/workspace 命令）
 *
 * 显示切换成功 + 该工作区下最近会话列表，引导用户 /switch 或 /new。
 */
export function buildWorkspaceSwitchedCard(
  workspaceName: string,
  sessions: Array<{ id: string; title: string; index: number }>,
): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = []

  elements.push({
    tag: 'markdown',
    content: `已切换到工作区: **${workspaceName}**`,
  })

  if (sessions.length > 0) {
    elements.push({ tag: 'hr' })
    const lines = sessions.map(
      (s) => `  **${s.index}.** ${s.title}`,
    )
    elements.push({
      tag: 'markdown',
      content: `**最近会话**\n${lines.join('\n')}`,
    })
  }

  elements.push({ tag: 'hr' })
  elements.push({
    tag: 'note',
    elements: [{
      tag: 'plain_text',
      content: sessions.length > 0
        ? '使用 /switch <序号> 继续已有会话 | 直接发消息或 /new 创建新会话'
        : '直接发送消息或 /new 创建新会话',
    }],
  })

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '切换工作区' },
      template: 'green',
    },
    elements,
  }
}

/**
 * 构建工作区列表卡片（/workspace 无参数时）
 */
export function buildWorkspaceListCard(
  workspaces: Array<{ index: number; name: string; isCurrent: boolean }>,
): Record<string, unknown> {
  const lines = workspaces.map((w) =>
    w.isCurrent
      ? `▶ **${w.index}.** ${w.name}（当前）`
      : `  **${w.index}.** ${w.name}`,
  )

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '选择工作区' },
      template: 'blue',
    },
    elements: [
      {
        tag: 'markdown',
        content: lines.length > 0 ? lines.join('\n') : '暂无工作区',
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: '使用 /workspace <序号或名称> 切换工作区' }],
      },
    ],
  }
}

/**
 * 构建帮助卡片（/help 命令）
 */
export function buildHelpCard(): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Proma Bot 命令' },
      template: 'blue',
    },
    elements: [
      {
        tag: 'markdown',
        content: [
          '括号内为简写命令',
          '`/help` (`/h`) — 显示帮助',
          '`/new` (`/n`) `[标题]` — 创建新 Agent 会话',
          '`/now` — 查看当前状态（工作区、会话、模型、MCP、Skills 等）',
          '`/list` (`/ls`) — 列出所有会话',
          '`/stop` (`/s`) — 停止当前 Agent',
          '`/switch` (`/sw`) `<序号>` — 切换到已有会话',
          '`/workspace` (`/ws`) `<名称>` — 设置工作区',
          '`/model` (`/m`) `[渠道 [模型]]` — 查看或切换渠道/模型',
          '',
          '直接发送文本会自动创建或发送到当前会话。',
        ].join('\n'),
      },
    ],
  }
}

/**
 * 构建渠道列表卡片（/model 无参数时）
 */
export function buildChannelListCard(
  channels: Array<{ index: number; name: string; modelCount: number; isCurrent: boolean }>,
): Record<string, unknown> {
  const lines = channels.map((c) =>
    c.isCurrent
      ? `▶ **${c.index}.** ${c.name}（${c.modelCount} 个模型 · 当前）`
      : `  **${c.index}.** ${c.name}（${c.modelCount} 个模型）`,
  )

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '选择渠道' },
      template: 'blue',
    },
    elements: [
      {
        tag: 'markdown',
        content: lines.length > 0 ? lines.join('\n') : '暂无可用渠道',
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: '使用 /model <渠道序号> 查看模型' }],
      },
    ],
  }
}

/**
 * 构建模型列表卡片（/model <渠道序号> 时）
 */
export function buildModelListCard(
  channelName: string,
  channelIndex: number,
  models: Array<{ index: number; name: string; isCurrent: boolean }>,
): Record<string, unknown> {
  const lines = models.map((m) =>
    m.isCurrent
      ? `▶ **${m.index}.** ${m.name}（当前）`
      : `  **${m.index}.** ${m.name}`,
  )

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${channelName} 的模型` },
      template: 'blue',
    },
    elements: [
      {
        tag: 'markdown',
        content: lines.length > 0 ? lines.join('\n') : '该渠道暂无可用模型',
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          { tag: 'plain_text', content: `使用 /model ${channelIndex} <模型序号> 切换` },
        ],
      },
    ],
  }
}

/**
 * 构建模型切换成功卡片（/model <渠道> <模型> 时）
 */
export function buildModelSwitchedCard(
  channelName: string,
  modelName: string,
): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '已切换模型' },
      template: 'green',
    },
    elements: [
      {
        tag: 'markdown',
        content: `**渠道**: ${channelName}\n**模型**: ${modelName}`,
      },
    ],
  }
}

// ===== 工具函数 =====

/**
 * 格式化工具调用摘要行
 */
function formatToolSummaryLine(summaries: ToolSummary[], durationSeconds: number): string {
  if (summaries.length === 0 && durationSeconds === 0) return ''

  const parts: string[] = []

  if (summaries.length > 0) {
    const toolParts = summaries.map((s) => `${s.toolName} x${s.count}`)
    parts.push(`工具 ${toolParts.join(', ')}`)
  }

  if (durationSeconds > 0) {
    parts.push(`${Math.round(durationSeconds)}s`)
  }

  return parts.join(' | ')
}

/**
 * 截断文本以适应飞书卡片大小限制
 *
 * 飞书卡片约 30KB 限制，保守取 25000 字符。
 */
function truncateForFeishu(text: string, maxLength = 25000): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '\n\n... [内容过长，请在 Proma 中查看完整回复]'
}

/**
 * 将飞书消息内容拆分为多段（超长消息）
 */
export function splitLongContent(text: string, maxLength = 25000): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // 尝试在段落边界拆分
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength)
    if (splitIndex < maxLength * 0.5) {
      // 如果段落边界太靠前，退而在行边界拆分
      splitIndex = remaining.lastIndexOf('\n', maxLength)
    }
    if (splitIndex < maxLength * 0.5) {
      // 如果行边界也太靠前，硬拆
      splitIndex = maxLength
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).trimStart()
  }

  return chunks
}

/**
 * 累积工具使用次数（从 SDKMessage 的 tool_use block 中提取工具名）
 */
export function accumulateToolStart(
  summaries: Map<string, ToolSummary>,
  toolName: string,
): void {
  const existing = summaries.get(toolName)
  if (existing) {
    existing.count++
  } else {
    summaries.set(toolName, {
      toolName,
      count: 1,
      hasError: false,
    })
  }
}
