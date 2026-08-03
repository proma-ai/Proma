/**
 * Suggestion 信号提取 — 从消息/记忆/automation 中提取结构化信号
 *
 * 全部为确定性规则（不依赖 LLM），只对明确信号触发：
 * - 用户亲口说"以后/下次/明天/记得"这类词（explicitness 高）
 * - 重复行为模式
 * 模糊场景宁可不建议（对齐论文"该沉默时沉默"）。
 */

// ===== 信号模式表 =====

/** 纠正信号：用户指出 Agent 的错误/改进（明确信号） */
export const CORRECTION_PATTERNS = [
  /(?:以后|下次|记住|请记住|别再|不要|别再这样|希望你不要)[^。！？\n]{2,60}/,
  /(?:不要|别)[^。！？\n]{0,20}(?:这样|这么做|用这种方式)[^。！？\n]{0,40}/,
  /(?:我更喜欢|我更希望|我希望你(?:以后|下次))[^。！？\n]{2,60}/,
] as const

/** 跟进/时间表达信号：用户表达"稍后/明天/过一会"等延后意图 */
export const FOLLOWUP_PATTERNS = [
  /(?:明天|稍后|过一会|过会儿|晚点|等会|待会|之后|回头|下次再)[^。！？\n]{0,30}(?:继续|做|弄|处理|看|说|再|提醒|提交|完成|弄完|整理|写|弄好)/,
  /(?:继续|做|弄|处理|看|说|提醒)(?:明天|稍后|过一会|过会儿|晚点|等会|待会|之后|回头)/,
] as const

/** 自动化信号：用户表达重复性/周期性需求 */
export const AUTOMATION_PATTERNS = [
  /(?:每天|每周|每月|定期|每天都要|每天自动)[^。！？\n]{2,50}/,
  /(?:帮我盯|关注|跟进|监控|检查)[^。！？\n]{2,50}(?:每天|每周|状态|进展|更新)/,
] as const

/** 未完成信号：用户明确提及未完成任务/待办 */
export const TODO_PATTERNS = [
  /(?:还差|还没|没做完|未完|剩下|待办|还没完成|待会再|回头再|之后再)[^。！？\n]{0,40}/,
  /(?:这个任务|这件事|这个功能)(?:还没|未完|没做完|差一点|还差)/,
] as const

/** 明确拒绝词：当用户表现出不耐烦/不需要时，当轮不触发建议 */
export const NEGATIVE_PATTERNS = [
  /(?:不用|不需要|别管|算了|不用了|没事|就这样|到此为止)/,
] as const

// ===== 信号结构 =====

export interface CorrectionSignal {
  kind: 'correction'
  /** 用户原始纠正语句 */
  raw: string
  /** 提炼后的行为规则 */
  rule: string
  /** 触发消息索引 */
  messageIndex: number
  confidence: number
}

export interface FollowupSignal {
  kind: 'followup'
  /** 触发消息 */
  raw: string
  messageIndex: number
  confidence: number
}

export interface AutomationSignal {
  kind: 'automation'
  /** 触发消息 */
  raw: string
  messageIndex: number
  confidence: number
}

export interface RepeatSignal {
  kind: 'repeat'
  /** 重复行为描述（同一意图出现次数） */
  intent: string
  count: number
  messageIndexes: number[]
  confidence: number
}

export interface TodoSignal {
  kind: 'todo'
  /** 触发消息 */
  raw: string
  messageIndex: number
  confidence: number
}

export type Signal =
  | CorrectionSignal
  | FollowupSignal
  | AutomationSignal
  | RepeatSignal
  | TodoSignal

// ===== 提取实现 =====

/**
 * 从用户消息中提取建议信号。
 * @param userMessages 用户消息（按时间序）
 */
export function extractSignals(userMessages: string[]): Signal[] {
  const signals: Signal[] = []

  for (let i = 0; i < userMessages.length; i++) {
    const text = userMessages[i] ?? ''

    // 明确拒绝信号：直接跳过整条消息（避免在用户不耐烦时建议）
    if (NEGATIVE_PATTERNS.some((re) => re.test(text))) {
      continue
    }

    // 纠正信号（优先级最高，明确指令）
    for (const re of CORRECTION_PATTERNS) {
      const match = text.match(re)
      if (match) {
        const raw = match[0].trim()
        if (raw.length < 4) continue
        signals.push({
          kind: 'correction',
          raw,
          rule: raw,
          messageIndex: i,
          confidence: 0.95, // 用户明确表达纠正，高置信
        })
        break // 每条消息最多一个纠正信号
      }
    }

    // 自动化信号（周期性需求）
    for (const re of AUTOMATION_PATTERNS) {
      const match = text.match(re)
      if (match) {
        signals.push({
          kind: 'automation',
          raw: match[0].trim(),
          messageIndex: i,
          confidence: 0.85,
        })
        break
      }
    }

    // 跟进信号（时间表达）
    for (const re of FOLLOWUP_PATTERNS) {
      const match = text.match(re)
      if (match) {
        signals.push({
          kind: 'followup',
          raw: match[0].trim(),
          messageIndex: i,
          confidence: 0.8,
        })
        break
      }
    }

    // 未完成信号（明确提及待办）
    for (const re of TODO_PATTERNS) {
      const match = text.match(re)
      if (match) {
        signals.push({
          kind: 'todo',
          raw: match[0].trim(),
          messageIndex: i,
          confidence: 0.72,
        })
        break
      }
    }
  }

  // 重复行为检测：同一意图词出现 ≥2 次（跨消息）
  const repeatIntents = detectRepeatIntents(userMessages)
  signals.push(...repeatIntents)

  return signals
}

/** 重复意图检测：识别同一意图词在多条消息中反复出现 */
function detectRepeatIntents(userMessages: string[]): RepeatSignal[] {
  const intentCounts = new Map<string, { count: number; indexes: number[]; intent: string }>()

  for (let i = 0; i < userMessages.length; i++) {
    const text = userMessages[i] ?? ''
    // 提取意图核心词（"帮我 X" 中的 X）
    const intentMatch = text.match(/(?:帮我|请|麻烦|能不能|可以)([^，。！？\n]{2,24})/)
    if (!intentMatch) continue
    const intentGroup = intentMatch[1]
    if (!intentGroup) continue
    const intent = intentGroup.trim()
    if (intent.length < 2 || intent.length > 24) continue
    // 忽略纯疑问词
    if (/^(这个|那个|一下|看看|什么|怎么|为什么)$/.test(intent)) continue

    // 归一化意图键：取前 2 字（中文意图核心动词通常在前），
    // 使"总结今天的工作"与"总结一下进展"归为同一意图"总结"
    const intentKey = intent.slice(0, 2)
    if (/^(一下|这个|那个|帮我)$/.test(intentKey)) continue

    const existing = intentCounts.get(intentKey)
    if (existing) {
      existing.count += 1
      existing.indexes.push(i)
    } else {
      intentCounts.set(intentKey, { count: 1, indexes: [i], intent: intentGroup })
    }
  }

  const signals: RepeatSignal[] = []
  for (const [key, entry] of intentCounts) {
    if (entry.count >= 2 && entry.indexes.length >= 2) {
      signals.push({
        kind: 'repeat',
        intent: entry.intent ?? key,
        count: entry.count,
        messageIndexes: entry.indexes,
        // 重复次数越多越可信，但封顶 0.9
        confidence: Math.min(0.6 + (entry.count - 2) * 0.1, 0.9),
      })
    }
  }
  return signals
}

/** 规范化纠正规则：去掉句首引导词，提炼为可执行的规则文本 */
export function normalizeRule(raw: string): string {
  let rule = raw
  // 连续去掉句首引导词（支持多层，如"以后不要"）
  const LEADERS = [
    /^请记住/,
    /^我希望你/,
    /^我希望/,
    /^我更喜欢/,
    /^我更倾向/,
    /^以后/,
    /^下次/,
    /^记住/,
    /^不要/,
    /^别再/,
    /^别/,
  ]
  let changed = true
  while (changed) {
    changed = false
    for (const re of LEADERS) {
      if (re.test(rule)) {
        rule = rule.replace(re, '').trim()
        changed = true
      }
    }
  }
  if (!rule) rule = raw
  // 去尾标点
  rule = rule.replace(/[。！？]+$/, '')
  return rule
}

/** 是否为明确触发词（供 orchestrator 快速判断是否需要评估） */
export function hasStrongSignal(userMessages: string[]): boolean {
  for (const text of userMessages) {
    if (CORRECTION_PATTERNS.some((re) => re.test(text))) return true
    if (FOLLOWUP_PATTERNS.some((re) => re.test(text))) return true
    if (AUTOMATION_PATTERNS.some((re) => re.test(text))) return true
    if (TODO_PATTERNS.some((re) => re.test(text))) return true
  }
  return false
}
