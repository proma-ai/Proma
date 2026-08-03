/**
 * Suggestion Service — 主动建议编排层
 *
 * 对外稳定 API，供 orchestrator 钩子、IPC、UI 使用。
 * 设计要点：
 * - 会话结束钩子：evaluateSessionSuggestions(messages, sessionId) 生成建议并持久化
 * - 去重来源：automation 标题 + pending corrections + 已有建议记录
 * - 频率学习：recordFeedback 驱动类型权重
 * - 误报控制：threshold + 预算 + 同会话去重 + 用户永久屏蔽
 */

import type { SuggestionsIndex } from './types'
import {
  persistSuggestion,
  recordFeedback,
  listSuggestions,
  getSuggestion,
  suggestionsEnabled,
  setSuggestionsEnabled,
  suggestionStats,
  isTypeSilenced,
  typeWeights,
  readSuggestionsIndex,
} from './feedback'
import { evaluateSuggestions, DEFAULT_SUGGEST_OPTIONS } from './engine'
import { listAutomations } from '../automation-manager'
import { corrections as memoryCorrections, recentAtoms, proposeCorrection } from '../memory/service'
import type {
  SuggestionRecord,
  SuggestionStats,
  SuggestionFeedback,
} from '@proma/shared'

// ===== 基础状态 =====

export function suggestionsEnabledState(): boolean {
  return suggestionsEnabled()
}

export function setEnabledState(enabled: boolean): void {
  setSuggestionsEnabled(enabled)
}

// ===== 会话结束评估（orchestrator 钩子入口） =====

/**
 * 会话结束后评估是否产生建议。
 * 返回本次新增的待展示建议（可为空 = 该沉默）。
 * 调用方应 fire-and-forget（不阻塞会话结束流程）。
 */
export async function evaluateSessionSuggestions(
  messages: Array<{ role: string; content: string }>,
  ctx: { sessionId?: string } = {},
): Promise<SuggestionRecord[]> {
  if (!suggestionsEnabled()) return []
  try {
    const existing = listSuggestions('suggested')
    const existingForSession = existing.filter((r) => r.sessionId === ctx.sessionId)
    // 同会话已达预算则不再建议
    if (existingForSession.length >= DEFAULT_SUGGEST_OPTIONS.maxPerSession) return []

    const input: Parameters<typeof evaluateSuggestions>[0] = {
      messages: messages.map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content })),
      sessionId: ctx.sessionId,
      existingSessionSuggestions: existingForSession,
      existingAutomationTitles: loadAutomationTitles(),
      existingCorrectionRules: loadCorrectionRules(),
      sopCandidateCount: loadSopCandidateCount(),
    }

    const result = evaluateSuggestions(input, readSuggestionsIndex(), DEFAULT_SUGGEST_OPTIONS)
    if (result.candidates.length === 0) return []

    // 类型已连续忽略自动静默 → 跳过
    const candidate = result.candidates[0]
    if (!candidate) return []
    if (isTypeSilenced(candidate.kind)) return []

    const record = persistSuggestion(candidate, ctx.sessionId)
    return [record]
  } catch (error) {
    console.warn('[Suggestion] 会话建议评估失败:', error instanceof Error ? error.message : error)
    return []
  }
}

// ===== 建议操作（IPC / UI） =====

export function listSuggestionsForUI(status?: 'suggested' | 'accepted' | 'ignored' | 'never'): SuggestionRecord[] {
  return listSuggestions(status)
}

export function getSuggestionById(id: string): SuggestionRecord | undefined {
  return getSuggestion(id)
}

/**
 * 用户反馈处理。
 * accepted 时：对 memory_correction 动作实际执行（写入纠正候选）；其余动作由 UI 引导。
 */
export function handleSuggestionFeedback(id: string, feedback: SuggestionFeedback): { ok: boolean; error?: string } {
  if (!suggestionsEnabled()) return { ok: false, error: '主动建议已关闭' }
  const record = getSuggestion(id)
  if (!record) return { ok: false, error: '建议不存在' }

  // 接受 correction 动作：写入 memory 纠正候选（pending，用户可在记忆看板确认）
  if (feedback === 'accepted' && record.action.type === 'memory_correction') {
    try {
      proposeCorrection({ raw: record.action.raw, rule: record.action.rule, sessionId: record.sessionId })
    } catch (error) {
      console.warn('[Suggestion] 写入纠正候选失败:', error instanceof Error ? error.message : error)
    }
  }

  recordFeedback(id, feedback)
  return { ok: true }
}

/** 查询统计（UI） */
export function getSuggestionStats(): SuggestionStats {
  return suggestionStats()
}

/** 当前类型权重（调试/UI） */
export function getTypeWeights() {
  return typeWeights()
}

// ===== 内部：加载去重来源 =====

function loadAutomationTitles(): string[] {
  try {
    return listAutomations().map((a) => a.name)
  } catch {
    return []
  }
}

function loadCorrectionRules(): string[] {
  try {
    return memoryCorrections('pending').map((c) => c.rule)
  } catch {
    return []
  }
}

function loadSopCandidateCount(): number {
  try {
    return recentAtoms(100).filter((a) => a.type === 'sop').length
  } catch {
    return 0
  }
}

/** 公开索引读取（供 engine 使用，避免循环依赖） */
export type { SuggestionsIndex }
