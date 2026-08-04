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
  /** 免打扰时段（DND）：该时段内不产生新建议，避免打扰 */
  dnd?: SuggestionDndConfig
  /** 最近一次工作模式分析的状态（旧索引缺省为 idle） */
  analysis?: SuggestionAnalysisState
}

/** 免打扰时段配置（DND，MineContext 缺口的补全） */
export interface SuggestionDndConfig {
  enabled: boolean
  /** 开始时间（分钟，0-1439，如 22:30 → 1350） */
  startMin: number
  /** 结束时间（分钟，0-1439；支持跨午夜：start>end 表示 [start, 1440) ∪ [0, end)） */
  endMin: number
}

/** 最近一次工作模式分析的可审计状态，供主动中心解释结果与失败原因。 */
export interface SuggestionAnalysisState {
  status: 'idle' | 'running' | 'succeeded' | 'empty' | 'unavailable' | 'failed'
  startedAt?: number
  completedAt?: number
  added?: number
  message?: string
}

/** 默认 DND：关闭 */
export const DEFAULT_DND_CONFIG: SuggestionDndConfig = {
  enabled: false,
  startMin: 22 * 60 + 30,
  endMin: 8 * 60,
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
