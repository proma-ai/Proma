/**
 * Suggestion（主动建议）相关类型
 *
 * Proma Proactive Suggestion：在 Agent 会话过程中主动向用户提出有价值的建议，
 * 并随用户反馈（接受/忽略/不再建议）自我调节频率 —— "越用越好用"。
 *
 * 设计参考：
 * - ProactiveAgent（ICLR 2025）：误报控制（该沉默时沉默）、时机学习（P9）、轻量三态交互（P12）
 * - Proactive Center 蓝图 §7：Recommendation 结构 / duplicateKey / 降噪机制
 */

/** 建议类型 */
export type SuggestionKind =
  | 'correction' // 用户纠正信号 → 记住这个纠正
  | 'followup' // 时间表达 → 创建跟进提醒
  | 'automation' // 重复行为 → 建议开启定时任务
  | 'skill' // SOP 候选 → 沉淀为 Skill
  | 'todo' // 未完成任务 → 创建 Todo

/** 建议可执行动作（用户接受后由主进程执行） */
export type SuggestionAction =
  | { type: 'memory_correction'; raw: string; rule: string }
  | { type: 'open_automation_create'; automationTitle: string; suggestedPrompt: string }
  | { type: 'open_memory_board' }
  | { type: 'open_skill_creator'; topic: string }

/** 主动建议候选（引擎生成，未持久化） */
export interface SuggestionCandidate {
  /** 稳定去重键（跨运行/跨会话）：kind + 核心实体，如 "automation:每日总结" */
  duplicateKey: string
  kind: SuggestionKind
  /** 建议标题（短） */
  title: string
  /** 建议理由（人能理解） */
  reason: string
  /** 触发证据（哪句话/哪个信号触发） */
  evidence: string
  /** 原始置信度 0-1（规则信号强度） */
  rawConfidence: number
  /** 用户接受后执行的动作 */
  action: SuggestionAction
}

/** 已持久化的建议记录（含反馈状态） */
export interface SuggestionRecord extends SuggestionCandidate {
  id: string
  /** 来源会话 ID */
  sessionId?: string
  /** 状态：suggested=待展示，accepted=已接受，ignored=已忽略，never=不再建议这类 */
  status: 'suggested' | 'accepted' | 'ignored' | 'never'
  /** 创建时间 */
  createdAt: number
  /** 最近反馈时间 */
  feedbackAt?: number
}

/** 建议反馈（用户三态） */
export type SuggestionFeedback = 'accepted' | 'ignored' | 'never'

/** 建议统计（UI/调试用） */
export interface SuggestionStats {
  /** 待展示建议数 */
  suggestedCount: number
  /** 今日接受/忽略/不再建议数 */
  todayAccepted: number
  todayIgnored: number
  todayNever: number
  /** 各类型权重（频率学习当前状态） */
  typeWeights: Record<SuggestionKind, number>
}

/** 建议引擎评估输入 */
export interface SuggestionEvaluationInput {
  /** 会话消息（user/assistant 文本，按时间序） */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 来源会话 ID */
  sessionId?: string
  /** 当前会话已展示的建议（用于同会话去重） */
  existingSessionSuggestions?: SuggestionRecord[]
  /** 已有自动化任务名称（去重：已有任务不重复推荐） */
  existingAutomationTitles?: string[]
  /** 已有 pending correction 规则（去重） */
  existingCorrectionRules?: string[]
  /** SOP 候选数量（触发 skill 建议） */
  sopCandidateCount?: number
}

/** 建议引擎评估输出 */
export interface SuggestionEvaluationResult {
  /** 本次评估生成的候选（已按置信度+频率排序，可能为空 = 该沉默） */
  candidates: SuggestionCandidate[]
  /** 被抑制的候选（原因调试用） */
  suppressed: Array<{ candidate: SuggestionCandidate; reason: string }>
}
