/**
 * Suggestion 模块 — 主动建议引擎
 *
 * 目标：在 Agent 会话过程中主动识别"值得建议的时机"，提出轻量、可解释、可反馈的建议。
 * 核心信条（ProactiveAgent ICLR 2025）：**"该沉默时沉默"也是能力**。
 * 主动性 = 用户接受率，不是建议次数。
 *
 * 模块划分：
 * - signals.ts   信号提取：从消息/记忆/automation 中提取结构化信号
 * - rules.ts     确定性规则：5 类建议（correction/followup/automation/skill/todo）
 * - engine.ts    决策：置信度评分 + 去重 + 频率学习 + 预算
 * - feedback.ts  反馈持久化：接受/忽略/不再建议 → 类型权重调节
 */

export * from './types'
export * from './rules'
export * from './engine'
export * from './feedback'
