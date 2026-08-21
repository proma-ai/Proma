/**
 * 用量统计服务
 *
 * 从 ~/.proma/agent-sessions/*.jsonl 提取 LLM 调用用量并聚合持久化，
 * 供"用量统计"面板展示 token 消耗与费用（USD）。
 *
 * 统计口径（防重复）：
 * - Token：逐条 assistant 消息 message.usage（input / output / cache_read / cache_creation）
 *   - 兜底：会话完全没有 assistant usage（如 GLM-5.2 等走 Anthropic 兼容端点的流式渠道），
 *     退而用该会话所有 result 消息的聚合 usage 计 token。
 * - 费用：sum(result.total_cost_usd)——SDK 实测成本；缺失渠道不自行估算（避免错误定价）。
 * - 运行次数：result 消息条数（每轮 Agent run 结束一条）。
 * - 时间：按消息顶层 _createdAt（毫秒）归入本地自然日 yyyy-mm-dd。
 * - 拆分：provider × model 双维度。
 *
 * 增量策略：usage-stats.json 记录每个会话文件的 { size, mtimeMs } 指纹与其按日贡献；
 * 只有新增/变更的文件才重扫（detach 旧贡献 → 扫描 → attach 新贡献），
 * 避免每次打开面板都全量扫 63+ 份 JSONL 阻塞主进程。
 * 运行时新消耗随消息落盘自然被下一轮增量补扫捕获（面板内 30s 轮询刷新即可）。
 */

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageBreakdownDailyRow, UsageBreakdownRow, UsageDayRow, UsageStatsSnapshot, UsageTokens } from '@proma/shared'
import { getAgentSessionsDir, getConfigDir } from './config-paths'

// 对外类型直接复用 @proma/shared，避免主/渲染进程类型漂移
export type { UsageBreakdownDailyRow, UsageBreakdownRow, UsageDayRow, UsageStatsSnapshot, UsageTokens }

// ─── 内部聚合结构 ───

interface ModelBucket {
  tokens: UsageTokens
  costUsd: number
  runs: number
}

interface ProviderBucket {
  tokens: UsageTokens
  costUsd: number
  runs: number
  models: Record<string, ModelBucket>
}

interface DayBucket {
  tokens: UsageTokens
  costUsd: number
  runs: number
  providers: Record<string, ProviderBucket>
}

interface SessionFingerprint {
  size: number
  mtimeMs: number
  /** 该会话按日贡献（用于增量 detach） */
  days: Record<string, DayBucket>
}

export interface UsageStatsCacheFile {
  version: 1
  lastScannedAt: number
  sessions: Record<string, SessionFingerprint>
  days: Record<string, DayBucket>
}

const CACHE_FILENAME = 'usage-stats.json'
const CACHE_VERSION = 1

const EMPTY_TOKENS: UsageTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }

function emptyTokens(): UsageTokens {
  return { ...EMPTY_TOKENS }
}

function addTokens(target: UsageTokens, src: UsageTokens): void {
  target.inputTokens += src.inputTokens
  target.outputTokens += src.outputTokens
  target.cacheReadTokens += src.cacheReadTokens
  target.cacheCreationTokens += src.cacheCreationTokens
}

function emptyModelBucket(): ModelBucket {
  return { tokens: emptyTokens(), costUsd: 0, runs: 0 }
}

function emptyProviderBucket(): ProviderBucket {
  return { tokens: emptyTokens(), costUsd: 0, runs: 0, models: {} }
}

function emptyDayBucket(): DayBucket {
  return { tokens: emptyTokens(), costUsd: 0, runs: 0, providers: {} }
}

function addModelBucket(target: ModelBucket, value: { tokens?: UsageTokens; costUsd?: number; runs?: number }): void {
  if (value.tokens) addTokens(target.tokens, value.tokens)
  target.costUsd += value.costUsd ?? 0
  target.runs += value.runs ?? 0
}

function addDayBucket(target: DayBucket, value: DayBucket): void {
  addTokens(target.tokens, value.tokens)
  target.costUsd += value.costUsd
  target.runs += value.runs
  for (const [provider, pBucket] of Object.entries(value.providers)) {
    const targetProvider = (target.providers[provider] ??= emptyProviderBucket())
    addTokens(targetProvider.tokens, pBucket.tokens)
    targetProvider.costUsd += pBucket.costUsd
    targetProvider.runs += pBucket.runs
    for (const [model, mBucket] of Object.entries(pBucket.models)) {
      const targetModel = (targetProvider.models[model] ??= emptyModelBucket())
      addModelBucket(targetModel, mBucket)
    }
  }
}

function subtractDayBucket(target: DayBucket, value: DayBucket): void {
  target.tokens.inputTokens -= value.tokens.inputTokens
  target.tokens.outputTokens -= value.tokens.outputTokens
  target.tokens.cacheReadTokens -= value.tokens.cacheReadTokens
  target.tokens.cacheCreationTokens -= value.tokens.cacheCreationTokens
  target.costUsd -= value.costUsd
  target.runs -= value.runs
  for (const [provider, pBucket] of Object.entries(value.providers)) {
    const targetProvider = target.providers[provider]
    if (!targetProvider) continue
    targetProvider.tokens.inputTokens -= pBucket.tokens.inputTokens
    targetProvider.tokens.outputTokens -= pBucket.tokens.outputTokens
    targetProvider.tokens.cacheReadTokens -= pBucket.tokens.cacheReadTokens
    targetProvider.tokens.cacheCreationTokens -= pBucket.tokens.cacheCreationTokens
    targetProvider.costUsd -= pBucket.costUsd
    targetProvider.runs -= pBucket.runs
    for (const [model, mBucket] of Object.entries(pBucket.models)) {
      const targetModel = targetProvider.models[model]
      if (!targetModel) continue
      targetModel.tokens.inputTokens -= mBucket.tokens.inputTokens
      targetModel.tokens.outputTokens -= mBucket.tokens.outputTokens
      targetModel.tokens.cacheReadTokens -= mBucket.tokens.cacheReadTokens
      targetModel.tokens.cacheCreationTokens -= mBucket.tokens.cacheCreationTokens
      targetModel.costUsd -= mBucket.costUsd
      targetModel.runs -= mBucket.runs
    }
  }
}

// ─── 持久化 ───

function getCachePath(): string {
  return join(getConfigDir(), CACHE_FILENAME)
}

function loadCache(): UsageStatsCacheFile {
  const path = getCachePath()
  if (!existsSync(path)) {
    return { version: CACHE_VERSION, lastScannedAt: 0, sessions: {}, days: {} }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<UsageStatsCacheFile>
    if (raw.version !== CACHE_VERSION) {
      return { version: CACHE_VERSION, lastScannedAt: 0, sessions: {}, days: {} }
    }
    return {
      version: CACHE_VERSION,
      lastScannedAt: raw.lastScannedAt ?? 0,
      sessions: raw.sessions ?? {},
      days: raw.days ?? {},
    }
  } catch {
    return { version: CACHE_VERSION, lastScannedAt: 0, sessions: {}, days: {} }
  }
}

function persistCache(cache: UsageStatsCacheFile): void {
  try {
    const configDir = getConfigDir()
    mkdirSync(configDir, { recursive: true })
    writeFileSync(getCachePath(), JSON.stringify(cache), 'utf-8')
  } catch (err) {
    console.warn('[用量统计] 缓存写入失败:', err)
  }
}

// ─── 会话文件扫描 ───

interface UsageLine {
  ts: number
  provider: string
  model: string
  usage: UsageTokens | null
  costUsd: number
  isResult: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 毫秒时间戳 → 本地自然日 yyyy-mm-dd */
export function localDayKey(tsMs: number): string {
  const d = new Date(tsMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function safeParseUsage(raw: unknown): UsageTokens | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const inputTokens = num(u.input_tokens)
  const outputTokens = num(u.output_tokens)
  const cacheReadTokens = num(u.cache_read_input_tokens)
  const cacheCreationTokens = num(u.cache_creation_input_tokens)
  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens === 0) return null
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
}

function toProvider(provider: unknown): string {
  return typeof provider === 'string' && provider.trim() ? provider.trim() : 'unknown'
}

function toModel(model: unknown): string {
  return typeof model === 'string' && model.trim() ? model.trim() : 'unknown'
}

/**
 * 解析一条 JSONL 消息为用量行。
 *
 * 只关心两类：
 * - assistant：message.usage 是单次模型调用（含子 agent 调用），计 token
 * - result（每轮 run 结束）：usage 为整轮聚合，计 cost 与 runs；token 仅在
 *   会话完全没有 assistant usage 时兜底使用
 */
export function parseUsageLine(raw: string): UsageLine | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const msg = parsed as Record<string, unknown>

  const tsRaw = msg._createdAt
  const ts = typeof tsRaw === 'number' && Number.isFinite(tsRaw) ? tsRaw : Date.now()
  const provider = toProvider(msg._channelProvider)
  const model = toModel(msg._channelModelId)

  if (msg.type === 'result') {
    const costRaw = msg.total_cost_usd
    const costUsd = typeof costRaw === 'number' && Number.isFinite(costRaw) ? costRaw : 0
    return {
      ts,
      provider,
      model,
      usage: safeParseUsage(msg.usage),
      costUsd,
      isResult: true,
    }
  }

  if (msg.type === 'assistant') {
    const inner = (msg.message ?? {}) as Record<string, unknown>
    const usage = safeParseUsage(inner.usage)
    const fallbackModel = typeof inner.model === 'string' && inner.model.trim() ? inner.model.trim() : undefined
    return {
      ts,
      provider,
      model: model === 'unknown' && fallbackModel ? fallbackModel : model,
      usage,
      costUsd: 0,
      isResult: false,
    }
  }

  return null
}

/**
 * 全量解析一个会话文件，返回按日贡献。
 *
 * token 主口径为 assistant 消息；整文件没有任何 assistant usage 时，
 * 用 result 聚合 usage 兜底计 token。
 */
export function scanSessionFile(filePath: string): Record<string, DayBucket> {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return {}
  }

  const assistantLines: UsageLine[] = []
  const resultLines: UsageLine[] = []

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    const usageLine = parseUsageLine(line)
    if (!usageLine) continue
    if (usageLine.isResult) resultLines.push(usageLine)
    else assistantLines.push(usageLine)
  }

  const hasAssistantUsage = assistantLines.some((l) => l.usage !== null)
  const tokenSource = hasAssistantUsage
    ? assistantLines.filter((l) => l.usage !== null)
    : resultLines.filter((l) => l.usage !== null)

  const days: Record<string, DayBucket> = {}

  const addLine = (line: UsageLine, countTokens: boolean, countRun: boolean, costUsd: number) => {
    const dayKey = localDayKey(line.ts)
    const day = (days[dayKey] ??= emptyDayBucket())
    const providerBucket = (day.providers[line.provider] ??= emptyProviderBucket())
    const modelBucket = (providerBucket.models[line.model] ??= emptyModelBucket())
    if (countTokens && line.usage) {
      addTokens(day.tokens, line.usage)
      addTokens(providerBucket.tokens, line.usage)
      addModelBucket(modelBucket, { tokens: line.usage })
    }
    if (countRun || costUsd > 0) {
      const runs = countRun ? 1 : 0
      day.runs += runs
      providerBucket.runs += runs
      addModelBucket(modelBucket, { runs })
      if (costUsd > 0) {
        day.costUsd += costUsd
        providerBucket.costUsd += costUsd
        addModelBucket(modelBucket, { costUsd })
      }
    }
  }

  if (hasAssistantUsage) {
    for (const line of assistantLines) addLine(line, true, false, 0)
    for (const line of resultLines) addLine(line, false, true, line.costUsd)
  } else {
    // 全部走 result：token 兜底 + runs + cost
    for (const line of resultLines) addLine(line, true, true, line.costUsd)
  }

  return days
}

// ─── 增量扫描 ───

function listSessionFiles(dir = getAgentSessionsDir()): { id: string; filePath: string; size: number; mtimeMs: number }[] {
  if (!existsSync(dir)) return []
  const result: { id: string; filePath: string; size: number; mtimeMs: number }[] = []
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue
      const filePath = join(dir, file)
      try {
        const stat = statSync(filePath)
        if (!stat.isFile()) continue
        result.push({ id: file.slice(0, -6), filePath, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch {
        // 跳过无法读取的文件
      }
    }
  } catch {
    // 目录不可读则返回空
  }
  return result
}

function detachSession(cache: UsageStatsCacheFile, id: string): void {
  const fingerprint = cache.sessions[id]
  if (!fingerprint) return
  for (const [dayKey, dayBucket] of Object.entries(fingerprint.days)) {
    const target = cache.days[dayKey]
    if (!target) continue
    subtractDayBucket(target, dayBucket)
    // 清理归零的桶，避免脏数据膨胀
    if (target.runs === 0 && target.costUsd === 0 && totalTokenCount(target.tokens) === 0) {
      delete cache.days[dayKey]
    }
  }
  delete cache.sessions[id]
}

function totalTokenCount(tokens: UsageTokens): number {
  return tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens
}

function attachSession(cache: UsageStatsCacheFile, id: string, fingerprint: SessionFingerprint): void {
  cache.sessions[id] = fingerprint
  for (const [dayKey, dayBucket] of Object.entries(fingerprint.days)) {
    addDayBucket((cache.days[dayKey] ??= emptyDayBucket()), dayBucket)
  }
}

function rescanSession(cache: UsageStatsCacheFile, id: string, filePath: string, size: number, mtimeMs: number): void {
  detachSession(cache, id)
  const days = scanSessionFile(filePath)
  attachSession(cache, id, { size, mtimeMs, days })
}

/** 找到内容有变化的会话并重扫，返回重扫数量。 */
export function applyIncrementalScan(cache: UsageStatsCacheFile, dir?: string): number {
  const files = listSessionFiles(dir)
  const seenIds = new Set<string>()
  let rescanned = 0

  for (const file of files) {
    seenIds.add(file.id)
    const fingerprint = cache.sessions[file.id]
    if (fingerprint && fingerprint.size === file.size && fingerprint.mtimeMs === file.mtimeMs) continue
    rescanSession(cache, file.id, file.filePath, file.size, file.mtimeMs)
    rescanned++
  }

  // 清理已不存在的会话文件贡献（用户清理存储/归档删除时同步扣除）
  for (const id of Object.keys(cache.sessions)) {
    if (!seenIds.has(id)) detachSession(cache, id)
  }

  if (rescanned > 0) cache.lastScannedAt = Date.now()
  else cache.lastScannedAt = cache.lastScannedAt || Date.now()
  return rescanned
}

/** 忽略指纹全量重扫（面板"重新扫描"）。 */
export function rescanAll(dir?: string): UsageStatsSnapshot {
  const cache = loadCache()
  const files = listSessionFiles(dir)
  for (const file of files) {
    rescanSession(cache, file.id, file.filePath, file.size, file.mtimeMs)
  }
  // 清理不存在的
  const seenIds = new Set(files.map((f) => f.id))
  for (const id of Object.keys(cache.sessions)) {
    if (!seenIds.has(id)) detachSession(cache, id)
  }
  cache.lastScannedAt = Date.now()
  persistCache(cache)
  return buildSnapshot(cache)
}

// ─── 快照构建 ───

function buildBreakdownRows(cache: UsageStatsCacheFile, byModel: boolean): UsageBreakdownRow[] {
  const rows: UsageBreakdownRow[] = []
  for (const dayBucket of Object.values(cache.days)) {
    for (const [provider, pBucket] of Object.entries(dayBucket.providers)) {
      if (byModel) {
        for (const [model, mBucket] of Object.entries(pBucket.models)) {
          if (mBucket.runs === 0 && totalTokenCount(mBucket.tokens) === 0 && mBucket.costUsd === 0) continue
          rows.push({
            provider,
            model,
            tokens: { ...mBucket.tokens },
            costUsd: mBucket.costUsd,
            runs: mBucket.runs,
          })
        }
      } else {
        if (pBucket.runs === 0 && totalTokenCount(pBucket.tokens) === 0 && pBucket.costUsd === 0) continue
        rows.push({
          provider,
          model: '*',
          tokens: { ...pBucket.tokens },
          costUsd: pBucket.costUsd,
          runs: pBucket.runs,
        })
      }
    }
  }
  // 排序：runs 降序，其次 token 降序，保证 UI 稳定
  rows.sort((a, b) => b.runs - a.runs || totalTokenCount(b.tokens) - totalTokenCount(a.tokens))
  return rows
}

/** 按自然日 × 渠道 × 模型展开缓存聚合，day 升序；供面板按时间范围过滤后重新聚合 */
function buildBreakdownDaily(cache: UsageStatsCacheFile): UsageBreakdownDailyRow[] {
  const rows: UsageBreakdownDailyRow[] = []
  for (const [day, dayBucket] of Object.entries(cache.days).sort()) {
    for (const [provider, pBucket] of Object.entries(dayBucket.providers)) {
      for (const [model, mBucket] of Object.entries(pBucket.models)) {
        if (mBucket.runs === 0 && totalTokenCount(mBucket.tokens) === 0 && mBucket.costUsd === 0) continue
        rows.push({
          day,
          provider,
          model,
          tokens: { ...mBucket.tokens },
          costUsd: mBucket.costUsd,
          runs: mBucket.runs,
        })
      }
    }
  }
  return rows
}

export function buildSnapshot(cache: UsageStatsCacheFile): UsageStatsSnapshot {
  const totals = { tokens: emptyTokens(), costUsd: 0, runs: 0, sessions: Object.keys(cache.sessions).length }
  const daily: UsageDayRow[] = []
  for (const [dayKey, dayBucket] of Object.entries(cache.days).sort()) {
    addTokens(totals.tokens, dayBucket.tokens)
    totals.costUsd += dayBucket.costUsd
    totals.runs += dayBucket.runs
    daily.push({
      day: dayKey,
      tokens: { ...dayBucket.tokens },
      costUsd: dayBucket.costUsd,
      runs: dayBucket.runs,
    })
  }
  // 去掉 token 全零但 sessions 存在的空壳（避免 totals 为 0 的会话数误导）
  return {
    version: CACHE_VERSION,
    lastScannedAt: cache.lastScannedAt,
    totals,
    daily,
    byProvider: buildBreakdownRows(cache, false),
    byModel: buildBreakdownRows(cache, true),
    breakdownDaily: buildBreakdownDaily(cache),
  }
}

// ─── 对外入口 ───

/**
 * 获取用量统计快照。
 *
 * 先返回缓存，若发现变更会话则增量补扫并即时返回最新结果。
 * 面板每次请求都会调用，成本约等于读取一份小 JSON + 变更文件重扫。
 */
export function getUsageStatsSnapshot(): UsageStatsSnapshot {
  const cache = loadCache()
  const rescanned = applyIncrementalScan(cache)
  if (rescanned > 0) {
    try {
      persistCache(cache)
    } catch {
      // 写失败不阻断返回
    }
  }
  return buildSnapshot(cache)
}