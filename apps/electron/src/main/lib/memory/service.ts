/**
 * Memory Service — 长期记忆编排层
 *
 * 对外暴露的稳定 API，供 prompt 构建器、内置 MCP 工具、会话结束钩子使用。
 * 只做编排与降级，不包含 LLM 调用细节（extractor 负责）与存储细节（store 负责）。
 */

import {
  getMemoryStats,
  isMemoryEnabled,
  setMemoryEnabled,
  readAllAtoms,
  writeAtomWithDedup,
  writeAtom,
  addCorrection,
  listCorrections,
  updateCorrectionStatus,
  readPersonaRaw,
  isPersonaTraceable,
  parsePersonaProfile,
  writePersona,
  readAllScenes,
  getAtomById,
  listPendingAtoms,
  listAtomsPaged,
  confirmAtom,
  deleteAtom,
  getExtractionMode,
  setExtractionMode,
  isPersonaInjectionEnabled,
  setPersonaInjectionEnabled,
  deletePersona,
  clearAllMemory,
  appendMemoryLog,
  markExtractionCompleted,
} from './store'
import { hotScenes as computeHotScenes } from './scene'
import {
  buildMemoryContextForMessage,
  searchMemoriesByKeyword,
  searchMemoriesHybrid,
  formatRecallContext,
  DEFAULT_RECALL_LIMIT,
} from './recall'
import { extractFromMessages, isMemoryLlmConfigured, callLlm } from './extractor'
import { generatePersona, buildPersonaFromRules, extractPersonaSources } from './persona'
import type {
  MemoryAtom,
  MemoryAtomType,
  MemoryCandidate,
  MemoryCaptureInput,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStats,
  PersonaProfile,
} from '@proma/shared'

// ===== 基础状态 =====

export function memoryEnabled(): boolean {
  return isMemoryEnabled()
}

/** 当前提取模式 */
export function extractionMode(): 'llm' | 'rule' | 'off' {
  return getExtractionMode()
}

/** 设置提取模式 */
export function setExtractionModeState(mode: 'llm' | 'rule' | 'off'): void {
  setExtractionMode(mode)
  appendMemoryLog(`提取模式切换为: ${mode}`)
}

/** persona 注入开关状态 */
export function personaInjectionEnabled(): boolean {
  return isPersonaInjectionEnabled()
}

/** 设置 persona 注入开关 */
export function setPersonaInjectionEnabledState(enabled: boolean): void {
  setPersonaInjectionEnabled(enabled)
  appendMemoryLog(enabled ? '开启 persona 画像注入' : '关闭 persona 画像注入（不再随系统提示发送）')
}

/** 删除 persona 画像（用户控制） */
export function removePersona(): boolean {
  const ok = deletePersona()
  if (ok) appendMemoryLog('用户删除 persona 画像')
  return ok
}

/** 清空全部记忆（用户控制） */
export function clearAllMemoryState(): void {
  clearAllMemory()
  appendMemoryLog('用户清空全部记忆')
}

export function setEnabled(enabled: boolean): void {
  setMemoryEnabled(enabled)
  appendMemoryLog(enabled ? '记忆功能已启用' : '记忆功能已关闭')
}

export function stats(): MemoryStats {
  return getMemoryStats()
}

// ===== 主动回忆 =====

/** 给用户消息构建可注入的 memory 上下文块（空串 = 无需注入） */
export function contextForMessage(userText: string, opts: { limit?: number } = {}): string {
  if (!isMemoryEnabled()) return ''
  try {
    return buildMemoryContextForMessage(userText, opts)
  } catch (error) {
    console.error('[Memory] 构建回忆上下文失败:', error)
    return ''
  }
}

/** 检索记忆（工具用，同步 keyword） */
export function search(request: MemorySearchRequest): MemorySearchResult {
  return searchMemoriesByKeyword(request)
}

/** 检索记忆（异步 hybrid：keyword + embedding + 规则加权；embedding 不可用时降级 keyword） */
export async function searchAsync(request: MemorySearchRequest): Promise<MemorySearchResult> {
  const providerReady = (await import('./embedding')).getEmbeddingProvider()
  if (providerReady) {
    return searchMemoriesHybrid(request)
  }
  return searchMemoriesByKeyword(request)
}

/** 检索并渲染为纯文本（工具/调试用） */
export function searchAsText(request: MemorySearchRequest): string {
  const result = searchMemoriesByKeyword(request)
  if (result.hits.length === 0) return '未找到相关记忆。'
  return formatRecallContext(result) || '未找到相关记忆。'
}

// ===== 主动记忆（Agent 工具直接沉淀，不走 LLM） =====

/**
 * 直接写入一条记忆（memory_capture 工具路径）。
 * 返回是否实际新增（false = 与已有记忆重复，已合并更新）。
 */
export function captureCandidate(
  candidate: MemoryCandidate,
  ctx: { sessionId?: string; workspaceSlug?: string } = {},
  opts: { confirmed?: boolean } = {},
): { stored: boolean; deduplicated: boolean; atom: MemoryAtom } {
  if (!isMemoryEnabled()) throw new Error('记忆功能已关闭')
  const result = writeAtomWithDedup({
    content: candidate.content.trim(),
    type: candidate.type,
    priority: candidate.priority ?? 50,
    sessionId: ctx.sessionId,
    workspaceSlug: ctx.workspaceSlug,
    confirmed: opts.confirmed ?? true,
  })
  appendMemoryLog(`手动沉淀: [${result.atom.type}] ${result.atom.content.slice(0, 60)}${result.deduplicated ? '（合并已有）' : ''}${result.atom.confirmed ? '' : '（待确认）'}`)
  return { stored: !result.deduplicated, deduplicated: result.deduplicated, atom: result.atom }
}

/**
 * 批量写入候选（供 LLM 提取管道调用）
 *
 * @param opts.confirmed 提取的记忆是否立即生效。LLM 自动提取应传 false（默认 pending，需用户确认），
 *                       显式 memory_capture 工具传 true（用户明确要求记住，即时生效）。
 */
export function captureCandidates(
  candidates: MemoryCandidate[],
  ctx: { sessionId?: string; workspaceSlug?: string } = {},
  opts: { confirmed?: boolean } = {},
): { storedCount: number; deduplicatedCount: number; atoms: MemoryAtom[] } {
  let storedCount = 0
  let deduplicatedCount = 0
  const atoms: MemoryAtom[] = []
  for (const candidate of candidates) {
    if (!candidate.content?.trim()) continue
    try {
      const result = captureCandidate(candidate, ctx, opts)
      atoms.push(result.atom)
      if (result.stored) storedCount += 1
      else deduplicatedCount += 1
    } catch (error) {
      console.warn('[Memory] 写入候选失败:', candidate.content.slice(0, 40), error)
    }
  }
  return { storedCount, deduplicatedCount, atoms }
}

// ===== 行为纠正 =====

/** 新增纠正候选（默认 pending，需用户确认） */
export function proposeCorrection(input: { raw: string; rule: string; sessionId?: string }) {
  if (!isMemoryEnabled()) throw new Error('记忆功能已关闭')
  // P2-2 白名单：规则必须有实质内容且长度受控，防投毒/膨胀
  const rule = (input.rule ?? '').trim()
  if (!rule || rule.length < 2 || rule.length > 500) {
    console.warn('[Memory] 拒绝非法纠正规则（长度异常）:', rule.slice(0, 40))
    throw new Error('纠正规则内容不合法')
  }
  const correction = addCorrection({ raw: (input.raw ?? '').trim().slice(0, 1000), rule, sessionId: input.sessionId })
  appendMemoryLog(`新增行为纠正候选: ${correction.rule.slice(0, 60)}`)
  return correction
}

export function corrections(status?: 'pending' | 'active' | 'rejected' | 'superseded') {
  return listCorrections(status)
}

/** 确认纠正后生效（若该类型同时写为 atom 则同步） */
export function confirmCorrection(id: string): boolean {
  const correction = updateCorrectionStatus(id, 'active')
  if (!correction) return false
  appendMemoryLog(`行为纠正已生效: ${correction.rule.slice(0, 60)}`)
  // 同时沉淀为 correction 类型 atom，便于回忆
  writeAtom({
    content: correction.rule,
    type: 'correction',
    priority: 80,
    confirmed: true,
    sessionId: correction.sessionId,
    metadata: { correctionId: correction.id },
  })
  // 反馈回流：确认的纠正应进入 persona 交互协议（用户明确认可的行为规则）
  void ensurePersona().catch(() => undefined)
  return true
}

export function rejectCorrection(id: string): boolean {
  return !!updateCorrectionStatus(id, 'rejected')
}

/**
 * 撤销一条已生效的纠正（P2-2 用户控制）：
 * - 状态从 active 回退为 rejected
 * - 删除 confirmCorrection 时沉淀的 correction 类型 atom
 * - 异步重生成 persona（去掉已回滚规则）
 * 返回是否成功。
 */
export function undoCorrection(id: string): boolean {
  const correction = updateCorrectionStatus(id, 'rejected')
  if (!correction) return false
  appendMemoryLog(`撤销行为纠正: ${correction.rule.slice(0, 60)}`)
  // 删除确认时沉淀的 atom（metadata.correctionId === id 的 correction 类型条目）
  const atom = readAllAtoms({ includeUnconfirmed: true }).find(
    (a) => a.type === 'correction' && a.metadata?.correctionId === id,
  )
  if (atom) deleteAtom(atom.id)
  // 反馈回流：重生成 persona（移除该规则）
  void ensurePersona().catch(() => undefined)
  return true
}

// ===== 待确认记忆（自动提取，需用户确认） =====

/** 列出待确认的自动提取记忆 */
export function pendingAtoms() {
  return listPendingAtoms()
}

/** 分页浏览全部记忆（记忆看板视图） */
export function atomsPaged(opts: {
  page?: number
  pageSize?: number
  type?: import('@proma/shared').MemoryAtomType | 'all'
  sort?: 'newest' | 'priority'
  confirmed?: boolean
} = {}) {
  return listAtomsPaged(opts)
}

/** 确认一条待确认记忆（生效并进入召回） */
export function confirmAtomById(id: string): MemoryAtom | undefined {
  const atom = confirmAtom(id)
  if (atom) {
    appendMemoryLog(`确认记忆: [${atom.type}] ${atom.content.slice(0, 60)}`)
    // 确认的行为规则类记忆应同步进 persona
    if (atom.type === 'correction' || atom.type === 'preference' || atom.type === 'sop') {
      void ensurePersona().catch(() => undefined)
    }
  }
  return atom
}

/** 拒绝并删除一条待确认记忆 */
export function rejectAtomById(id: string): boolean {
  const ok = deleteAtom(id)
  if (ok) appendMemoryLog(`拒绝记忆: ${id}`)
  return ok
}

// ===== L3 Persona =====

export function personaRaw(): string | undefined {
  return readPersonaRaw()
}

/** persona 证据溯源：返回每条画像条目的来源 atom id（供 UI 展示溯源入口） */
export function personaSources(): Array<{ text: string; sources: string[] }> {
  const raw = readPersonaRaw()
  if (!raw) return []
  return extractPersonaSources(raw)
}

/** persona 是否溯源版本（旧版需重生成） */
export function personaTraceable(): boolean {
  return isPersonaTraceable()
}

/** 手动重新生成 persona（用户控制，B3） */
export async function regeneratePersona(): Promise<boolean> {
  return ensurePersona()
}

export function persona(): PersonaProfile {
  return parsePersonaProfile(readPersonaRaw())
}

/** 更新 persona（由 extractor 的 LLM 生成后调用；原文覆盖写） */
export function updatePersona(markdown: string): void {
  writePersona(markdown)
  appendMemoryLog('用户画像已更新')
}

/** 用户手动编辑 persona（与 LLM 自动生成 updatePersona 区分） */
export function savePersona(markdown: string): void {
  writePersona(markdown)
  appendMemoryLog('用户手动编辑 persona 画像')
}

/**
 * 确保 persona 存在/更新：
 * - 无 persona 且 LLM 可用 → LLM 生成
 * - 无 persona 且无 LLM → 规则版兜底
 * - 已有 persona → LLM 增量更新（保留稳定内容）
 * 返回是否成功生成/更新。
 */
export async function ensurePersona(): Promise<boolean> {
  const existing = readPersonaRaw()
  // B3：旧版 persona（无溯源版本标记）强制重生成，让 src 溯源标注落地
  const forceRegenerate = existing ? !isPersonaTraceable() : false
  try {
    if (isMemoryLlmConfigured()) {
      const markdown = await generatePersona({ existing })
      if (markdown) {
        writePersona(markdown)
        appendMemoryLog(forceRegenerate ? '用户画像已重生成（溯源版本）' : existing ? '用户画像已增量更新' : '用户画像已生成')
        return true
      }
    }
    if (!existing || forceRegenerate) {
      const fallback = buildPersonaFromRules()
      if (fallback) {
        writePersona(fallback)
        appendMemoryLog(forceRegenerate ? '用户画像已重生成（规则版兜底，溯源版本）' : '用户画像已生成（规则版兜底）')
        return true
      }
    }
    return false
  } catch (error) {
    console.warn('[Memory] persona 生成失败:', error instanceof Error ? error.message : error)
    return false
  }
}

// ===== 查询辅助 =====

export function recentAtoms(limit = 20): MemoryAtom[] {
  return readAllAtoms({ includeUnconfirmed: false }).slice(0, limit)
}

/**
 * 工作记忆摘要（参考 Nowledge Mem Working Memory）：
 * 从最近 todo_context（任务上下文）与高优先级 preference 生成当前活跃任务快照。
 * 用于新会话/压缩后快速恢复工作状态。
 */
export function workingMemory(limit = 5): { items: string[]; updatedAt?: number } {
  const atoms = readAllAtoms({ includeUnconfirmed: false })
  const tasks = atoms
    .filter((a) => a.type === 'todo_context')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.createdAt - a.createdAt)
    .slice(0, limit)
  if (tasks.length === 0) return { items: [] }
  return {
    items: tasks.map((t) => t.content),
    updatedAt: tasks[0]?.createdAt,
  }
}

export function atomById(id: string): MemoryAtom | undefined {
  return getAtomById(id)
}

export function scenes() {
  return readAllScenes()
}

// ===== L2 场景（主动性的时机信号） =====

/** 最近热点场景（实时聚类，按热度降序） */
export function getHotScenes(opts: { windowDays?: number; limit?: number } = {}) {
  return computeHotScenes(opts)
}

/** 最近热点场景摘要（纯文本，供注入/分析） */
export function hotScenesSummary(limit = 3): string {
  try {
    const scenes = getHotScenes({ limit })
    if (scenes.length === 0) return ''
    return scenes
      .map((s) => `- [${s.title}] heat=${s.heat} atoms=${s.atomIds.length}`)
      .join('\n')
  } catch {
    return ''
  }
}

// ===== 提取管道入口（Phase 3） =====

/**
 * 从对话消息提取记忆并写入。
 * 优先 LLM 结构化提取；LLM 未配置或失败时回退规则版（识别明确纠正/偏好信号）。
 */
export async function extractFromConversation(input: MemoryCaptureInput): Promise<{
  storedCount: number
  deduplicatedCount: number
  atoms: MemoryAtom[]
  corrections: number
  mode: 'llm' | 'rule' | 'none'
}> {
  const candidates: MemoryCandidate[] = []
  let correctionCount = 0

  // 提取模式：off 直接跳过；rule 仅规则版（零外发）；llm 全量
  const mode_ = getExtractionMode()
  if (mode_ === 'off') {
    return { storedCount: 0, deduplicatedCount: 0, atoms: [], corrections: 0, mode: 'none' }
  }

  const messages = (input.messages ?? []).filter(
    (m) => m && typeof m.content === 'string' && m.content.trim().length > 0,
  )
  if (messages.length === 0) {
    return { storedCount: 0, deduplicatedCount: 0, atoms: [], corrections: 0, mode: 'none' }
  }

  let mode: 'llm' | 'rule' | 'none' = 'none'

  // 1) LLM 提取（仅 llm 模式；rule 模式零外发）
  if (mode_ === 'llm' && isMemoryLlmConfigured()) {
    try {
      const llmCandidates = await extractFromMessages(messages)
      if (llmCandidates.length > 0) {
        candidates.push(...llmCandidates)
        mode = 'llm'
      }
    } catch (error) {
      console.warn('[Memory] LLM 提取失败，回退规则版:', error instanceof Error ? error.message : error)
    }
  }

  // 2) 规则版兜底（LLM 未配置/未提取到内容，或 rule 模式始终走规则版）
  if (mode_ === 'rule' || candidates.length === 0) {
    for (const msg of messages) {
      if (msg.role !== 'user') continue
      const text = msg.content.trim()
      if (text.length < 4) continue

      const correctionMatch = text.match(/(?:以后|下次|记住|别再|不要|请记住)[^。！？\n]{2,80}/)
      if (correctionMatch) {
        const raw = correctionMatch[0].trim()
        proposeCorrection({ raw, rule: raw, sessionId: input.sessionId })
        correctionCount += 1
        mode = 'rule'
      }
      const prefMatch = text.match(/(?:我喜欢|我偏好|我更倾向|用|使用)[^。！？\n]{2,80}/)
      if (prefMatch) {
        candidates.push({ content: prefMatch[0].trim(), type: 'preference', priority: 60 })
        mode = 'rule'
      }
    }
  }

  // LLM/规则提取的记忆为自动生成，默认 pending（需用户确认后才注入上下文），阻断投毒链
  const result = captureCandidates(candidates, { sessionId: input.sessionId, workspaceSlug: input.workspaceSlug }, { confirmed: false })
  if (result.storedCount > 0 || correctionCount > 0) {
    markExtractionCompleted()
    // 有新增记忆时，异步刷新 persona（不阻塞提取返回）
    void ensurePersona().catch(() => undefined)
  }
  return { ...result, corrections: correctionCount, mode: mode as 'llm' | 'rule' | 'none' }
}

/**
 * 会话结束钩子入口：接收最近对话消息，异步提取并捕获记忆（不阻塞调用方）。
 * 返回提取结果摘要。
 */
export async function extractAndCapture(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ctx: { sessionId?: string; workspaceSlug?: string } = {},
): Promise<{ storedCount: number; corrections: number; mode: 'llm' | 'rule' | 'none' }> {
  if (!isMemoryEnabled()) return { storedCount: 0, corrections: 0, mode: 'none' }
  const result = await extractFromConversation({
    messages,
    sessionId: ctx.sessionId,
    workspaceSlug: ctx.workspaceSlug,
  })
  if (result.storedCount > 0 || result.corrections > 0) {
    console.log(`[Memory] 主动记忆捕获完成: ${result.storedCount} 条新增, ${result.corrections} 条纠正, mode=${result.mode}`)
  }
  return { storedCount: result.storedCount, corrections: result.corrections, mode: result.mode }
}

/** LLM 是否已配置（供工具/UI 展示） */
export function isLlmConfigured(): boolean {
  return isMemoryLlmConfigured()
}

/** 默认召回条数（供工具描述使用） */
export const DEFAULT_RECALL_LIMIT_ = DEFAULT_RECALL_LIMIT
export type { MemoryAtomType, MemoryCandidate }
