/**
 * Suggestion Analyst — 工作模式分析器（Phase B 方向 2）
 *
 * 从规则引擎的"明确信号触发"进化到"隐含模式发现"：
 * - 规则引擎（rules.ts）：用户明确说"以后不要 X / 明天继续" → 立即建议
 * - 分析器（本文件）：低频（每日/手动）用 LLM 分析近期记忆 + 会话摘要，
 *   识别重复出现的**工作模式**（SOP 候选 / 重复检查 / 待沉淀偏好），
 *   输出 schema 校验过的建议候选，写入 suggestions 复用三态反馈。
 *
 * 设计（蓝图 §7.4 第二阶段）：
 * - 输入经过截断与脱敏（只取记忆条目摘要，不含完整会话）
 * - 主进程只接受 schema 校验通过、权限可解释、duplicateKey 合法的推荐
 * - LLM 不能直接创建 Schedule/Monitor，只能提出候选
 */

import { callLlm, isMemoryLlmConfigured } from '../memory/extractor'
import { recentAtoms, persona, corrections as memoryCorrections } from '../memory/service'
import { listAutomations } from '../automation-manager'
import type { SuggestionCandidate, SuggestionKind } from '@proma/shared'

/** 分析器允许产出的建议类型（保守：只产出规则引擎也能处理、有明确动作的类型） */
const ALLOWED_KINDS: SuggestionKind[] = ['automation', 'skill', 'todo']

/** 单次分析最多产出的候选数 */
const MAX_CANDIDATES = 3

/** LLM 输出解析失败返回空 */
const ANALYST_PROMPT = `你是一位工作模式分析助手。请分析用户的长期记忆，发现**重复出现的工作模式**，并给出可执行的建议。

输入：
- 近期记忆条目（fact/preference/correction/sop/todo_context 类型）
- 用户画像（persona）
- 已生效的行为纠正规则
- 已存在的定时任务名称（避免重复推荐）

任务：
1. 识别**重复模式**：同一类操作反复出现（如"每次发版前检查清单""每周要手动汇总"）
2. 识别**可沉淀的流程**（SOP）：多步骤操作重复 ≥2 次
3. 识别**值得自动化的日常**：定期/周期性工作
4. 识别**待确认的偏好**：用户反复表达但未固化的规则

输出格式（严格 JSON 数组，不要输出其他内容）：
[
  {
    "kind": "automation" | "skill" | "todo",
    "title": "简短标题（≤20 字）",
    "reason": "建议理由（一句，解释为什么值得做）",
    "evidence": "证据（基于哪些记忆条目）",
    "duplicateKey": "去重键（如 automation:每周发版检查）",
    "action": {
      "type": "open_automation_create" | "open_skill_creator" | "open_memory_board",
      "automationTitle": "（automation 类型）建议的定时任务标题",
      "suggestedPrompt": "（automation 类型）定时任务执行提示词",
      "topic": "（skill 类型）Skill 主题"
    }
  }
]

约束：
- 只输出确有证据的模式，不确定就输出 []
- 不要重复已有定时任务（见输入）
- kind=automation 时 action.type=open_automation_create；kind=skill 时 open_skill_creator；kind=todo 时 open_memory_board
- 每个候选必须能回答"为什么现在值得做"
`

/** 分析器输出（LLM 原始响应解析前） */
interface AnalystRawCandidate {
  kind?: string
  title?: string
  reason?: string
  evidence?: string
  duplicateKey?: string
  action?: {
    type?: string
    automationTitle?: string
    suggestedPrompt?: string
    topic?: string
  }
}

/** 构建分析输入摘要 */
function buildAnalysisInput(): string {
  const atoms = recentAtoms(60)
  if (atoms.length === 0) return '（暂无记忆）'

  const sections: string[] = []
  sections.push('近期记忆条目：')
  for (const atom of atoms.slice(0, 40)) {
    sections.push(`- [${atom.type}] ${atom.content.slice(0, 100)}`)
  }

  const p = persona()
  if (p.summary || p.preferences.length > 0) {
    sections.push('\n用户画像：')
    if (p.summary) sections.push(`- 定位: ${p.summary}`)
    for (const pref of p.preferences.slice(0, 8)) sections.push(`- 偏好: ${pref}`)
  }

  const activeCorrections = memoryCorrections('active')
  if (activeCorrections.length > 0) {
    sections.push('\n已生效行为规则：')
    for (const c of activeCorrections.slice(0, 5)) sections.push(`- ${c.rule}`)
  }

  const automations = listAutomations().map((a) => a.name)
  if (automations.length > 0) {
    sections.push(`\n已有定时任务：${automations.join('、')}`)
  }

  return sections.join('\n')
}

/** 解析 LLM 输出为候选数组（围栏剥离 + JSON 解析容错） */
export function parseAnalystResponse(raw: string): AnalystRawCandidate[] {
  if (!raw || raw.trim().length === 0) return []
  // 剥离 markdown 围栏
  let text = raw.trim()
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch?.[1]) text = fenceMatch[1].trim()
  // 找第一个 [ 到最后一个 ]
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []
  const jsonText = text.slice(start, end + 1)
  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AnalystRawCandidate => {
      return !!item && typeof item === 'object'
    }) as AnalystRawCandidate[]
  } catch {
    return []
  }
}

/** schema 校验单条候选：字段完整、类型合法、动作匹配 */
export function validateAnalystCandidate(raw: AnalystRawCandidate): SuggestionCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const kind = raw.kind
  if (!kind || !ALLOWED_KINDS.includes(kind as SuggestionKind)) return null
  const title = raw.title?.trim()
  const reason = raw.reason?.trim()
  const evidence = raw.evidence?.trim()
  const duplicateKey = raw.duplicateKey?.trim()
  if (!title || !reason || !evidence || !duplicateKey) return null
  if (title.length > 40 || reason.length > 200 || evidence.length > 200) return null

  // 动作校验
  const action = raw.action
  const actionType = action?.type
  if (!actionType) return null
  if (kind === 'automation') {
    if (actionType !== 'open_automation_create') return null
    const automationTitle = action.automationTitle?.trim()
    const suggestedPrompt = action.suggestedPrompt?.trim()
    if (!automationTitle || !suggestedPrompt) return null
    return {
      kind,
      title,
      reason,
      evidence,
      duplicateKey,
      rawConfidence: 0.7, // LLM 分析产出的候选默认中等置信（需用户确认）
      action: { type: 'open_automation_create', automationTitle, suggestedPrompt },
    }
  }
  if (kind === 'skill') {
    if (actionType !== 'open_skill_creator') return null
    const topic = action.topic?.trim()
    if (!topic) return null
    return {
      kind,
      title,
      reason,
      evidence,
      duplicateKey,
      rawConfidence: 0.65,
      action: { type: 'open_skill_creator', topic },
    }
  }
  if (kind === 'todo') {
    if (actionType !== 'open_memory_board') return null
    return {
      kind,
      title,
      reason,
      evidence,
      duplicateKey,
      rawConfidence: 0.6,
      action: { type: 'open_memory_board' },
    }
  }
  return null
}

/** 校验并过滤候选数组 */
export function validateAnalystCandidates(raw: AnalystRawCandidate[]): SuggestionCandidate[] {
  const result: SuggestionCandidate[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const candidate = validateAnalystCandidate(item)
    if (!candidate) continue
    // duplicateKey 去重
    if (seen.has(candidate.duplicateKey)) continue
    seen.add(candidate.duplicateKey)
    result.push(candidate)
    if (result.length >= MAX_CANDIDATES) break
  }
  return result
}

/** 运行工作模式分析（LLM），返回合法候选（无 LLM/失败返回空） */
export async function runWorkPatternAnalysis(): Promise<SuggestionCandidate[]> {
  if (!isMemoryLlmConfigured()) return []
  try {
    const input = buildAnalysisInput()
    if (input === '（暂无记忆）') return []
    const response = await callLlm(
      ANALYST_PROMPT,
      input,
      { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000 },
    )
    if (!response) return []
    const parsed = parseAnalystResponse(response)
    return validateAnalystCandidates(parsed)
  } catch (error) {
    console.warn('[Analyst] 工作模式分析失败:', error instanceof Error ? error.message : error)
    return []
  }
}

/** LLM 是否已配置（供 UI/入口判断） */
export function analystAvailable(): boolean {
  return isMemoryLlmConfigured()
}
