/**
 * Turn 分组 — 将流式产生的 SDKMessage 列表(含同一回合的多行快照碎片)
 * 合并为可渲染/可导出的 Turn 分组。
 *
 * 这是 Proma 会话「快照去重」的唯一真源：Electron 渲染层、proma CLI 以及
 * 未来的 query 型接口都复用本模块，避免各处重抄一份会随存储格式漂移的解析器。
 *
 * 逻辑逐字迁移自 apps/electron 渲染层 SDKMessageRenderer.tsx，保持行为一致。
 */
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
} from '@proma/shared'
import { normalizeThinkTagsInContentBlocks } from './thinking-tags'

// ===== 辅助：从 SDKMessage 提取元数据 =====

export interface MessageMeta {
  createdAt?: number
}

export function extractMeta(message: SDKMessage): MessageMeta {
  const msg = message as Record<string, unknown>
  return {
    createdAt: typeof msg._createdAt === 'number' ? msg._createdAt : undefined,
  }
}

// ===== 辅助：从 user 消息中提取纯文本内容 =====

export function extractUserText(message: SDKUserMessage): string | null {
  const content = message.message?.content
  if (!Array.isArray(content)) return null

  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      texts.push((block as { text: string }).text)
    }
  }

  return texts.length > 0 ? texts.join('\n') : null
}

// ===== 辅助：判断 user 消息是否为真正的人类用户输入（非工具结果/子代理提示） =====

export function isUserInputMessage(message: SDKUserMessage): boolean {
  if (message.parent_tool_use_id) return false
  // SDK 合成消息（如 Skill 展开 prompt）不是用户输入
  if (message.isSynthetic) return false
  // 包含 tool_result 块的消息是工具结果，不是用户输入
  const content = message.message?.content
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) return false
  return extractUserText(message) !== null
}

// ===== Turn 分组类型 =====

export interface AssistantTurn {
  type: 'assistant-turn'
  /** 当前 turn 内所有 assistant 消息 */
  assistantMessages: SDKAssistantMessage[]
  /** 当前 turn 内所有消息（含 tool_result user 消息，供工具结果查找） */
  turnMessages: SDKMessage[]
  /** 模型名称（取首条 assistant 消息的 model） */
  model?: string
  /** 创建时间（取首条 assistant 消息的时间） */
  createdAt?: number
  /**
   * 该 turn 由后台任务完成通知（task_notification）唤醒后开始。
   * 用于阻断与前一 turn 的合并，让自动唤醒的新输出独立成块，而不是被追加进上一轮的消息块。
   */
  startsAfterWake?: boolean
}

export type MessageGroup =
  | { type: 'user'; message: SDKUserMessage }
  | { type: 'system'; message: SDKSystemMessage }
  | AssistantTurn

/**
 * 将 SDKMessage 列表分组为可渲染的 Turn
 *
 * 规则：
 * 1. user（真正用户输入）→ 单独的 user group
 * 2. assistant + user(tool_result) + assistant... → 合并为一个 assistant-turn
 * 3. system（compact_boundary / compacting / permission_denied）→ 独立渲染，其他归入当前 turn
 * 4. 其他类型（result, tool_progress 等）→ 归入当前 assistant-turn
 * 5. 后处理：合并相邻同模型的 assistant-turn（处理子代理切换模型导致的碎片化）
 */
export function groupIntoTurns(messages: SDKMessage[], sessionModelId?: string): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentTurn: AssistantTurn | null = null
  // 收到后台任务完成通知（task_notification）后，若没有用户输入就直接出现新的 assistant 输出，
  // 说明这是自动唤醒的新一轮，应另起独立消息块，而不是续接上一轮。
  // 注意：不能用 result 做信号——正常对话每轮也以 result 结束，会误伤普通回复。
  let pendingWakeBoundary = false

  const flushTurn = (): void => {
    if (currentTurn && currentTurn.assistantMessages.length > 0) {
      groups.push(currentTurn)
    }
    currentTurn = null
  }

  for (const msg of messages) {
    if (msg.type === 'user') {
      const userMsg = msg as SDKUserMessage
      if (isUserInputMessage(userMsg)) {
        // 真正的用户输入 → 结束当前 turn，开始新段落
        flushTurn()
        groups.push({ type: 'user', message: userMsg })
        pendingWakeBoundary = false
      } else {
        // tool_result 消息 → 归入当前 turn
        if (currentTurn) {
          currentTurn.turnMessages.push(msg)
        }
      }
    } else if (msg.type === 'assistant') {
      const aMsg = msg as SDKAssistantMessage
      // 跳过重放消息
      if (aMsg.isReplay) continue

      if (!currentTurn) {
        // 开始新 turn
        const meta = extractMeta(msg)
        currentTurn = {
          type: 'assistant-turn',
          assistantMessages: [aMsg],
          turnMessages: [msg],
          model: aMsg._channelModelId || aMsg.message?.model || sessionModelId,
          createdAt: meta.createdAt,
          // 紧跟在后台任务唤醒之后的新 turn：阻断与上一轮的合并
          startsAfterWake: pendingWakeBoundary || undefined,
        }
        pendingWakeBoundary = false
      } else {
        // 继续当前 turn
        currentTurn.assistantMessages.push(aMsg)
        currentTurn.turnMessages.push(msg)
      }
    } else if (msg.type === 'system') {
      const sysMsg = msg as SDKSystemMessage
      // 仅需要独立渲染的 system 消息才中断 turn（compact_boundary / compacting / permission_denied）
      // 其他 system 消息（如 init、task_started、task_progress）归入当前 turn，不中断分组
      if (sysMsg.subtype === 'compact_boundary' || sysMsg.subtype === 'compacting' || sysMsg.subtype === 'permission_denied') {
        flushTurn()
        groups.push({ type: 'system', message: sysMsg })
      } else if (sysMsg.subtype === 'task_notification') {
        // 后台任务完成通知：仅在没有进行中的 turn 时标记唤醒边界（真正的唤醒场景）。
        // 若当前有 turn 正在进行，归入当前 turn 不截断。
        if (currentTurn) {
          currentTurn.turnMessages.push(msg)
        } else {
          pendingWakeBoundary = true
        }
      } else if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    } else {
      // result, tool_progress 等 → 归入当前 turn
      // prompt_suggestion 不属于对话转录，不入 turn，避免被当作文本附加到助手消息末尾
      if ((msg as { type: string }).type === 'prompt_suggestion') {
        continue
      }
      if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    }
  }

  flushTurn()
  return mergeAdjacentSameModelTurns(groups)
}

/**
 * 后处理：合并相邻同模型的 assistant-turn
 *
 * 当子代理（如 haiku）执行多个工具调用时，中间的 user(tool_result) 消息
 * 可能导致 turn 被拆分为多个碎片。此函数将同模型的相邻 assistant-turn 合并，
 * 同时吸收它们之间的非用户输入 group（如被误判为用户输入的子代理内部消息）。
 */
function mergeAdjacentSameModelTurns(groups: MessageGroup[]): MessageGroup[] {
  if (groups.length <= 1) return groups

  const result: MessageGroup[] = []

  for (const group of groups) {
    if (group.type !== 'assistant-turn') {
      result.push(group)
      continue
    }

    // 后台任务唤醒后开始的 turn：独立成块，不向前合并。
    if (group.startsAfterWake) {
      result.push(group)
      continue
    }

    // 向前查找可合并的同模型 assistant-turn（跳过非 user-input 的中间 group）
    let mergeTargetIdx = -1
    for (let i = result.length - 1; i >= 0; i--) {
      const prev = result[i]!
      if (prev.type === 'user') break // 真正的用户输入阻断合并
      if (prev.type === 'system' && ['compact_boundary', 'permission_denied'].includes((prev.message as SDKSystemMessage).subtype ?? '')) break
      if (prev.type === 'assistant-turn') {
        if (prev.model === group.model) {
          mergeTargetIdx = i
        }
        break // 遇到第一个 assistant-turn 就停止（不跨越不同模型的 turn）
      }
      // system 或其他 group：继续向前查找
    }

    if (mergeTargetIdx >= 0) {
      const target = result[mergeTargetIdx] as AssistantTurn
      target.assistantMessages.push(...group.assistantMessages)
      target.turnMessages.push(...group.turnMessages)
    } else {
      result.push(group)
    }
  }

  return result
}

// ===== 预览/摘要 =====

const SCHEDULED_RUN_MARKER = '<!--PROMA_SCHEDULED_RUN-->'

export function stripScheduledRunMarker(text: string): string {
  return text.replaceAll(SCHEDULED_RUN_MARKER, '').trim()
}

/**
 * 从 MessageGroup 中提取纯文本预览，供迷你地图 / outline 使用
 */
export function getGroupPreview(group: MessageGroup): string {
  if (group.type === 'user') {
    return stripScheduledRunMarker(extractUserText(group.message) ?? '')
      .replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/, '')
      .replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '')
      .slice(0, 200)
  }
  if (group.type === 'system') {
    if (group.message.subtype === 'compact_boundary') return '上下文已压缩'
    if (group.message.subtype === 'compacting') return '正在压缩上下文...'
    if (group.message.subtype === 'permission_denied') return '自动审批已拒绝操作'
    return ''
  }
  // assistant-turn：收集所有 text 块
  const texts: string[] = []
  for (const aMsg of group.assistantMessages) {
    const rawBlocks = aMsg.message?.content
    if (!Array.isArray(rawBlocks)) continue
    for (const block of normalizeThinkTagsInContentBlocks(rawBlocks)) {
      if (block.type === 'text' && 'text' in block) {
        texts.push((block as { text: string }).text)
      }
    }
  }
  return texts.join(' ').slice(0, 200)
}
