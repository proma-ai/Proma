/**
 * Suggestion 决策引擎 — 候选生成 + 评分 + 去重 + 频率学习 + 预算
 *
 * 决策流程：
 * 1. 规则生成候选（applyRules）
 * 2. 补充分类候选（skill/todo，低频）
 * 3. 抑制：同会话已建议过 / 用户已"不再建议这类" / 明确拒绝上下文
 * 4. 频率加权：effectiveConfidence = rawConfidence × typeWeight
 * 5. 阈值过滤 + 预算截断（MVP：单次最多 1 条）
 */

import type {
  RuleContext,
  SuggestEngineOptions,
  SuggestionsIndex,
  SuggestionTypeWeights,
} from './types'
import type {
  SuggestionCandidate,
  SuggestionEvaluationInput,
  SuggestionEvaluationResult,
  SuggestionKind,
  SuggestionRecord,
} from '@proma/shared'
import { applyRules, buildSkillCandidate } from './rules'
import { NEGATIVE_PATTERNS, hasStrongSignal } from './signals'

// ===== 默认参数 =====

export const DEFAULT_SUGGEST_OPTIONS: SuggestEngineOptions = {
  /** 置信度阈值：raw × weight ≥ 0.6 才建议 */
  threshold: 0.6,
  /** 单次评估最多 1 条（低频优先，避免连环打扰） */
  maxPerEvaluation: 1,
  /** 同会话最多 2 条 */
  maxPerSession: 2,
}

/** 默认类型权重（初始） */
export function defaultTypeWeights(): SuggestionTypeWeights {
  return {
    correction: 1.0,
    followup: 1.0,
    automation: 1.0,
    skill: 0.8, // Skill 建议偏打扰，初始略低
    todo: 0.9, // Todo 建议初始略低（但必须 ≥ 0.72×0.9=0.648 > 0.6 阈值，避免死锁）
  }
}

// ===== 主入口 =====

/**
 * 评估一组会话消息，生成建议候选（已被频率/去重/预算过滤）。
 */
export function evaluateSuggestions(
  input: SuggestionEvaluationInput,
  index: SuggestionsIndex,
  opts: SuggestEngineOptions = DEFAULT_SUGGEST_OPTIONS,
): SuggestionEvaluationResult {
  const suppressed: SuggestionEvaluationResult['suppressed'] = []
  const userMessages = input.messages
    .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => m.content)

  if (userMessages.length === 0) return { candidates: [], suppressed }

  // 明确拒绝上下文：最后一条用户消息含"不用/算了"等，本轮不触发
  const lastUserMsg = userMessages[userMessages.length - 1] ?? ''
  if (NEGATIVE_PATTERNS.some((re) => re.test(lastUserMsg))) {
    return { candidates: [], suppressed }
  }

  const ctx: RuleContext = {
    userMessages,
    existingAutomationTitles: input.existingAutomationTitles ?? [],
    existingCorrectionRules: input.existingCorrectionRules ?? [],
    sopCandidateCount: input.sopCandidateCount ?? 0,
  }

  // 1. 规则候选
  const ruleMatches = applyRules(ctx)

  // 2. 补充 skill 候选（低频：有 SOP 积累时）
  const candidates: SuggestionCandidate[] = ruleMatches.map((m) => m.candidate)
  const skillCandidate = buildSkillCandidate(ctx.sopCandidateCount)
  if (skillCandidate) candidates.push(skillCandidate)

  // 同会话已建议数量
  const existingSession = input.existingSessionSuggestions ?? []
  const alreadySuggestedKeys = new Set(existingSession.map((r) => r.duplicateKey))
  const neverKeys = new Set(index.records.filter((r) => r.status === 'never').map((r) => r.duplicateKey))

  // 3. 去重 + 频率加权 + 阈值过滤
  const scored: Array<{ candidate: SuggestionCandidate; effective: number }> = []
  const seenKeys = new Set<string>()

  for (const candidate of candidates) {
    // 同会话去重
    if (alreadySuggestedKeys.has(candidate.duplicateKey)) {
      suppressed.push({ candidate, reason: '同会话已建议过' })
      continue
    }
    // 用户永久屏蔽
    if (neverKeys.has(candidate.duplicateKey)) {
      suppressed.push({ candidate, reason: '用户已选择不再建议这类' })
      continue
    }
    // 同次评估内去重
    if (seenKeys.has(candidate.duplicateKey)) {
      suppressed.push({ candidate, reason: '重复候选' })
      continue
    }
    seenKeys.add(candidate.duplicateKey)

    // 频率加权
    const weight = typeWeight(index, candidate.kind)
    const effective = candidate.rawConfidence * weight

    if (effective < opts.threshold) {
      suppressed.push({
        candidate,
        reason: `置信度不足(raw=${candidate.rawConfidence.toFixed(2)}, weight=${weight.toFixed(2)}, effective=${effective.toFixed(2)})`,
      })
      continue
    }

    scored.push({ candidate, effective })
  }

  // 4. 按有效置信度排序，取预算内
  scored.sort((a, b) => b.effective - a.effective)
  const top = scored.slice(0, opts.maxPerEvaluation).map((s) => s.candidate)

  return { candidates: top, suppressed }
}

/** 取类型权重（容忍旧索引文件缺字段） */
export function typeWeight(index: SuggestionsIndex, kind: SuggestionKind): number {
  const w = index.typeWeights?.[kind]
  if (typeof w === 'number' && w > 0) return w
  return 1.0
}

/** 判断是否需要评估（快速路径：有强信号才评估） */
export function shouldEvaluate(userMessages: string[]): boolean {
  return hasStrongSignal(userMessages)
}
