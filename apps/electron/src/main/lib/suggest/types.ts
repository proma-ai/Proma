/**
 * Suggestion 模块内部类型（复用 shared 类型，补充引擎内部结构）
 */

import type {
  SuggestionCandidate,
  SuggestionKind,
  SuggestionRecord,
} from '@proma/shared'

/** 频率学习权重：每个建议类型一个权重（0.2~2.0，初始 1.0） */
export interface SuggestionTypeWeights {
  correction: number
  followup: number
  automation: number
  skill: number
  todo: number
}

/** suggestions.json 索引文件格式 */
export interface SuggestionsIndex {
  version: number
  /** 全部建议记录（含历史） */
  records: SuggestionRecord[]
  /** 各类型频率权重 */
  typeWeights: SuggestionTypeWeights
  /** 全局启用状态 */
  enabled: boolean
}

/** 引擎决策参数（可调，默认值见 DEFAULT_SUGGEST_OPTIONS） */
export interface SuggestEngineOptions {
  /** 置信度触发阈值：rawConfidence × typeWeight ≥ threshold 才建议 */
  threshold: number
  /** 单次评估最多建议数（预算，MVP 为 1） */
  maxPerEvaluation: number
  /** 同会话最多建议数 */
  maxPerSession: number
}

/** 内置规则执行上下文 */
export interface RuleContext {
  /** 用户消息（按时间序，仅 user 角色） */
  userMessages: string[]
  /** 已有自动化任务标题（用于去重） */
  existingAutomationTitles: string[]
  /** 已有 pending correction 规则（用于去重） */
  existingCorrectionRules: string[]
  /** 已有 SOP 候选数量（memory atoms type=sop） */
  sopCandidateCount: number
}

export interface RuleMatch {
  candidate: SuggestionCandidate
}

export type { SuggestionCandidate, SuggestionKind, SuggestionRecord }
