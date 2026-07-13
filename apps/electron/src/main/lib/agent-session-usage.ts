/**
 * 读取一个 Agent session 当前的上下文占用率。
 *
 * 用途：automation 调度器在 daily 模式下决定是否要切到新会话——
 * 同一自然日内即便上次运行成功，如果上下文已经接近窗口上限，
 * 继续往里塞会导致本次运行刚开始就触发 SDK 自动压缩，得不偿失。
 *
 * 数据来源：~/.proma/agent-sessions/{id}.jsonl 里最后一条带 usage 的消息。
 * 优先级：
 * 1. SDK result 消息（subtype=success/error_*）：usage + modelUsage[?].contextWindow
 * 2. SDK assistant 消息：message.usage + 按 message.model 推断 contextWindow
 * 3. 都拿不到：返回 undefined（占用率未知），调度器按"保守复用"处理
 *
 * 已用 token 口径与渲染层（useGlobalAgentListeners / SDKMessageRenderer）保持一致：
 * input_tokens + cache_read_input_tokens + cache_creation_input_tokens。
 * 开启 prompt caching 后上下文绝大部分落在 cache_read 上，只取 input_tokens 会把
 * 真实占用率严重低估、令 daily 安全阀几乎无法触发。
 *
 * 性能：从文件尾部反向逐行惰性解析，命中第一条带 usage 的消息即返回，
 * 避免对整份会话 JSONL 全量 JSON.parse（高频 daily 任务一天可触发数百次）。
 */

import {
  calculateContextUsageRatio,
  resolveDisplayContextWindow,
} from '@proma/shared'
import type { SDKAssistantMessage, SDKResultMessage } from '@proma/shared'
import { existsSync, readFileSync } from 'node:fs'
import { getAgentSessionMessagesPath } from './config-paths'
import { getAgentSessionMeta } from './agent-session-manager'
import { getChannelById } from './channel-manager'

interface UsageTokens {
  input_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * 与渲染层一致的"已用上下文 token"口径：base input + 两类 cache token。
 */
function sumUsedTokens(usage: UsageTokens): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  )
}

/**
 * 从会话对应渠道的模型配置中读取用户手动填写的 contextWindow 覆盖值。
 *
 * 主进程 daily 用量统计路径：第三方兼容渠道改写 modelId 后按 modelId 推断可能不准，
 * 优先采用用户在渠道模型配置中填写的 contextWindow。SDK result 的 modelUsage[].contextWindow
 * 仍为最高优先级（在 pickResultContextWindow 内部处理）。
 */
function resolveSessionUserContextWindow(
  sessionId: string,
  modelId?: string,
): number | undefined {
  const meta = getAgentSessionMeta(sessionId)
  const channelId = meta?.channelId
  if (!channelId) return undefined
  const channel = getChannelById(channelId)
  if (!channel) return undefined
  // 优先匹配会话记录的 modelId，其次取任一配置了 contextWindow 的模型
  const byModel = channel.models.find((m) => m.id === modelId)
  if (byModel?.contextWindow != null) return byModel.contextWindow
  const anyOverride = channel.models.find((m) => m.contextWindow != null)
  return anyOverride?.contextWindow
}

export function getSessionContextUsageRatio(sessionId: string): number | undefined {
  const filePath = getAgentSessionMessagesPath(sessionId)
  if (!existsSync(filePath)) return undefined

  let lines: string[]
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n')
  } catch {
    return undefined
  }

  // 从尾部反向找最后一条带 usage 的 SDK 消息（result 优先，因为它带 modelUsage.contextWindow）。
  // 命中即返回，绝大多数情况下只需解析最后一行（result）或最后几行。
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line || !line.trim()) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const msg = parsed as { type?: string }

    if (msg.type === 'result') {
      const result = parsed as SDKResultMessage
      if (!result.usage) continue
      const usedTokens = sumUsedTokens(result.usage)
      const userContextWindow = resolveSessionUserContextWindow(sessionId)
      const contextWindow = pickResultContextWindow(result, userContextWindow)
      return calculateContextUsageRatio(usedTokens, contextWindow)
    }

    if (msg.type === 'assistant') {
      const asst = parsed as SDKAssistantMessage
      const usage = asst.message?.usage
      if (!usage) continue
      const usedTokens = sumUsedTokens(usage)
      const userContextWindow = resolveSessionUserContextWindow(sessionId, asst.message?.model)
      const contextWindow = resolveDisplayContextWindow({
        userContextWindow,
        modelId: asst.message?.model,
      })
      return calculateContextUsageRatio(usedTokens, contextWindow)
    }
  }

  return undefined
}

/**
 * 从 SDK result.modelUsage 多 entry 中选择代表性的 contextWindow。
 *
 * SDK 0.3.142+ Task 工具默认启用后，单次 result 可能包含多个模型（主对话 + 子 agent），
 * modelUsage 会有多个 entry。result.usage 是聚合值，其中大头通常属于主模型，
 * 所以用**最大** contextWindow 作为分母最接近"主模型视角的占用率"——这样：
 *   - 单 entry（常态）：行为与从前一致
 *   - 多 entry：避免被子 agent 的小窗口拉低、过早误触发 daily 切换阈值
 *
 * 每个 entry 优先用 SDK 实测的 contextWindow，缺失时按 modelId 推断。
 */
function pickResultContextWindow(
  result: SDKResultMessage,
  userContextWindow?: number,
): number | undefined {
  if (!result.modelUsage) return undefined
  let best: number | undefined
  for (const [modelId, info] of Object.entries(result.modelUsage)) {
    // SDK 实测 contextWindow 为最高优先级，缺失时回退到用户覆盖值 / modelId 推断
    const win = resolveDisplayContextWindow({
      sdkContextWindow: info?.contextWindow,
      userContextWindow,
      modelId,
    })
    if (best === undefined || win > best) best = win
  }
  return best
}
