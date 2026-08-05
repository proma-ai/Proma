/**
 * Suggestion 确定性规则 — 把信号转成建议候选
 *
 * 5 类规则：
 * - correction：用户纠正 → 记住这个纠正（动作：写入 memory correction）
 * - followup：时间表达 → 创建跟进提醒（动作：打开 automation 创建）
 * - automation：重复行为/周期需求 → 建议开启定时任务
 * - skill：SOP 候选积累 → 建议沉淀为 Skill
 * - todo：明确未完成任务 → 打开预填的 Todo 创建表单
 *
 * 全部只读本地确定性信号，不依赖 LLM。
 */

import type { RuleContext, RuleMatch } from './types'
import type { SuggestionCandidate } from '@proma/shared'
import { extractSignals, normalizeRule, isMeaningfulRule, type Signal } from './signals'

/** SOP 候选数量阈值：达到后建议沉淀为 Skill */
export const SOP_CANDIDATE_THRESHOLD = 3

/** 重复行为阈值：同一意图 ≥2 次建议 automation */
export const REPEAT_THRESHOLD = 2

/** 执行规则集：从信号 + 上下文生成建议候选 */
export function applyRules(ctx: RuleContext): RuleMatch[] {
  const matches: RuleMatch[] = []
  const signals = extractSignals(ctx.userMessages)

  for (const signal of signals) {
    const match = signalToCandidate(signal, ctx)
    if (match) matches.push(match)
  }

  return matches
}

/** 单条信号 → 候选（去重交给 engine） */
function signalToCandidate(signal: Signal, ctx: RuleContext): RuleMatch | undefined {
  switch (signal.kind) {
    case 'correction': {
      const rule = normalizeRule(signal.raw)
      // 无意义规则（"这样"/"再说"）不产生建议
      if (!isMeaningfulRule(rule)) return undefined
      // 去重：已有相同/相似 pending correction 不再建议
      const existing = ctx.existingCorrectionRules.some(
        (r) => r === rule || r.includes(rule) || rule.includes(r),
      )
      if (existing) return undefined

      return {
        candidate: {
          duplicateKey: `correction:${rule.slice(0, 30)}`,
          kind: 'correction',
          title: '记住这个纠正',
          reason: '你刚刚纠正了 Proma 的行为，建议把这条规则写入长期记忆，以后不再犯同样的错。',
          evidence: signal.raw,
          rawConfidence: signal.confidence,
          action: {
            type: 'memory_correction',
            raw: signal.raw,
            rule,
          },
        },
      }
    }

    case 'followup': {
      return {
        candidate: {
          duplicateKey: `followup:${signal.raw.slice(0, 24)}`,
          kind: 'followup',
          title: '创建跟进提醒',
          reason: '你提到了稍后继续，建议创建一个跟进提醒，到时间自动提示你继续这个任务。',
          evidence: signal.raw,
          rawConfidence: signal.confidence,
          action: {
            type: 'open_automation_create',
            automationTitle: '跟进提醒',
            suggestedPrompt: `提醒我：${signal.raw}`,
          },
        },
      }
    }

    case 'automation': {
      // 去重：已有同类 automation 任务不再建议
      const title = automationTitleFromRaw(signal.raw)
      const existing = ctx.existingAutomationTitles.some(
        (t) => t === title || t.includes(title) || title.includes(t),
      )
      if (existing) return undefined

      return {
        candidate: {
          duplicateKey: `automation:${title}`,
          kind: 'automation',
          title: '开启定时任务',
          reason: '你表达的是周期性/长期关注的需求，建议创建一个定时任务，让 Proma 无人值守地自动处理。',
          evidence: signal.raw,
          rawConfidence: signal.confidence,
          action: {
            type: 'open_automation_create',
            automationTitle: title,
            suggestedPrompt: `${title}（定期自动执行）`,
          },
        },
      }
    }

    case 'repeat': {
      if (signal.count < REPEAT_THRESHOLD) return undefined
      const title = `定期${signal.intent}`
      const existing = ctx.existingAutomationTitles.some(
        (t) => t === title || t.includes(signal.intent) || signal.intent.includes(t),
      )
      if (existing) return undefined

      return {
        candidate: {
          duplicateKey: `automation:${title}`,
          kind: 'automation',
          title: '把重复操作变成定时任务',
          reason: `你在本次会话中${signal.count}次要求"${signal.intent}"，建议创建一个定时任务自动完成，省去重复操作。`,
          evidence: `重复出现 ${signal.count} 次："${signal.intent}"`,
          rawConfidence: signal.confidence,
          action: {
            type: 'open_automation_create',
            automationTitle: title,
            suggestedPrompt: `定期执行：${signal.intent}`,
          },
        },
      }
    }

    case 'todo': {
      return {
        candidate: {
          duplicateKey: `todo:${signal.raw.slice(0, 20)}`,
          kind: 'todo',
          title: '把未完成任务记下来',
          reason: '你提到了未完成的事项，建议创建一个 Todo 记录，避免遗漏。',
          evidence: signal.raw,
          rawConfidence: signal.confidence,
          action: {
            type: 'open_todo_create',
            title: signal.raw.slice(0, 120),
            notes: '由 Proma 主动建议创建；请确认内容和截止时间。',
          },
        },
      }
    }

    default:
      return undefined
  }
}

/** SOP 候选 → Skill 建议（由 engine 在候选后处理中调用） */
export function buildSkillCandidate(sopCount: number): SuggestionCandidate | undefined {
  if (sopCount < SOP_CANDIDATE_THRESHOLD) return undefined
  return {
    duplicateKey: `skill:sop-candidates`,
    kind: 'skill',
    title: '把常用流程沉淀为 Skill',
    reason: `长期记忆中已积累 ${sopCount} 条可复用流程（SOP），建议把它们整理成 Skill，以后一句话即可复用。`,
    evidence: `${sopCount} 条 SOP 候选`,
    rawConfidence: 0.75,
    action: {
      type: 'open_skill_creator',
      topic: 'SOP 流程沉淀',
    },
  }
}

/** 未完成任务候选（不再无条件生成，由 signal 驱动） */
export function buildTodoCandidate(): SuggestionCandidate | undefined {
  return undefined
}

/** 从自动化信号原始文本提炼任务标题 */
export function automationTitleFromRaw(raw: string): string {
  let title = raw
    .replace(/^(每天自动|每天都要|每天|每周|每月|定期)/, '')
    .replace(/^(帮我|请|麻烦|能不能|可以)/, '')
    .replace(/(帮我)?(盯|关注|跟进|监控|检查)(一下)?/, '')
    .replace(/[，。！？\n]+$/, '')
    .trim()
  if (!title) title = raw.slice(0, 20)
  return title.length > 24 ? title.slice(0, 24) : title
}

/** 调试辅助：列出某条消息命中的所有信号 */
export function debugSignals(userMessages: string[]): Signal[] {
  return extractSignals(userMessages)
}
