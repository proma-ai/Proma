import type {
  ChannelUsageRecord,
  ChannelUsageStats,
  ChannelUsageSummary,
  UsageLogQuery,
} from '@proma/shared'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { getAgentSessionsDir } from './config-paths'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export interface ChannelUsageStatsOptions {
  /** 测试、迁移或其它 profile 可显式传入；默认复用应用现有配置路径 API。 */
  sessionsDir?: string
  /** 仅用于确定 byHour 的“今天”，默认 Date.now()。 */
  now?: number
}

interface CostEvent {
  provider: string
  modelId: string
  createdAt: number
  costUsd: number
}

interface ScannedUsage {
  records: ChannelUsageRecord[]
  costs: CostEvent[]
}

interface MutableSummary {
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
  successCount: number
  errorCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function asTimestamp(value: unknown): number | undefined {
  const timestamp = asNonNegativeNumber(value)
  if (timestamp === undefined || Number.isNaN(new Date(timestamp).getTime())) return undefined
  return timestamp
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function readOptionalToken(value: unknown): number | undefined {
  return value === undefined ? 0 : asNonNegativeNumber(value)
}

function readCreatedAt(message: Record<string, unknown>): number | undefined {
  return asTimestamp(message._createdAt ?? message.createdAt)
}

function readAssistantRecord(
  message: Record<string, unknown>,
  sessionId: string,
  lineNumber: number,
): ChannelUsageRecord | undefined {
  if (message.type !== 'assistant' || !isRecord(message.message)) return undefined

  const usage = message.message.usage
  if (!isRecord(usage)) return undefined

  const provider = asNonEmptyString(message._channelProvider)
  const modelId = asNonEmptyString(message._channelModelId)
    ?? asNonEmptyString(message.message.model)
  const createdAt = readCreatedAt(message)
  const inputTokens = asNonNegativeNumber(usage.input_tokens)
  const outputTokens = readOptionalToken(usage.output_tokens)
  const cacheReadTokens = readOptionalToken(usage.cache_read_input_tokens)
  const cacheCreationTokens = readOptionalToken(usage.cache_creation_input_tokens)

  if (
    provider === undefined
    || modelId === undefined
    || createdAt === undefined
    || inputTokens === undefined
    || outputTokens === undefined
    || cacheReadTokens === undefined
    || cacheCreationTokens === undefined
  ) {
    return undefined
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  if (!Number.isFinite(totalTokens)) return undefined

  return {
    id: `${sessionId}:${lineNumber}`,
    sessionId,
    provider,
    modelId,
    createdAt,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    costUsd: 0,
    status: isRecord(message.error) ? 'error' : 'success',
  }
}

function readResultModelId(
  message: Record<string, unknown>,
  fallbackRecord: ChannelUsageRecord | undefined,
): string | undefined {
  const channelModelId = asNonEmptyString(message._channelModelId)
  if (channelModelId !== undefined) return channelModelId

  if (isRecord(message.modelUsage)) {
    const modelIds = Object.keys(message.modelUsage)
    if (modelIds.length === 1) return asNonEmptyString(modelIds[0])
  }

  return fallbackRecord?.modelId
}

function readResultCost(
  message: Record<string, unknown>,
  fallbackRecord: ChannelUsageRecord | undefined,
): CostEvent | undefined {
  if (message.type !== 'result' || !isRecord(message.usage)) return undefined

  const provider = asNonEmptyString(message._channelProvider)
  const modelId = readResultModelId(message, fallbackRecord)
  const createdAt = readCreatedAt(message)
  const costUsd = asNonNegativeNumber(message.total_cost_usd)

  if (
    provider === undefined
    || modelId === undefined
    || createdAt === undefined
    || costUsd === undefined
  ) {
    return undefined
  }

  return { provider, modelId, createdAt, costUsd }
}

function scanUsageFile(filePath: string): ScannedUsage {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return { records: [], costs: [] }
  }

  const records: ChannelUsageRecord[] = []
  const costs: CostEvent[] = []
  const sessionId = basename(filePath, extname(filePath))
  let pendingRecordIndex: number | undefined

  for (const [lineIndex, line] of content.split('\n').entries()) {
    if (!line.trim()) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue

    if (parsed.type === 'assistant') {
      const record = readAssistantRecord(parsed, sessionId, lineIndex + 1)
      if (record !== undefined) {
        records.push(record)
        pendingRecordIndex = records.length - 1
      }
      continue
    }

    if (parsed.type !== 'result') continue

    const pendingRecord = pendingRecordIndex === undefined
      ? undefined
      : records[pendingRecordIndex]

    if (pendingRecord !== undefined) {
      const subtype = asNonEmptyString(parsed.subtype)
      if (subtype !== undefined && subtype !== 'success') {
        pendingRecord.status = 'error'
      }
      const durationMs = asNonNegativeNumber(parsed._durationMs)
      if (durationMs !== undefined) pendingRecord.durationMs = durationMs
    }

    const cost = readResultCost(parsed, pendingRecord)
    if (cost !== undefined) {
      costs.push(cost)
      // result 是整轮汇总，只挂到最近一条 assistant 供明细展示；聚合不会再次读取此字段。
      if (
        pendingRecord !== undefined
        && pendingRecord.provider === cost.provider
        && pendingRecord.modelId === cost.modelId
      ) {
        pendingRecord.costUsd = cost.costUsd
      }
    }

    pendingRecordIndex = undefined
  }

  return { records, costs }
}

function scanUsageDirectory(sessionsDir: string): ScannedUsage {
  if (!existsSync(sessionsDir)) return { records: [], costs: [] }

  let fileNames: string[]
  try {
    fileNames = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name) === '.jsonl')
      .map((entry) => entry.name)
      .sort()
  } catch {
    return { records: [], costs: [] }
  }

  const records: ChannelUsageRecord[] = []
  const costs: CostEvent[] = []
  for (const fileName of fileNames) {
    const scanned = scanUsageFile(join(sessionsDir, fileName))
    records.push(...scanned.records)
    costs.push(...scanned.costs)
  }
  return { records, costs }
}

function matchesQuery(
  value: Pick<ChannelUsageRecord, 'provider' | 'modelId' | 'createdAt'>,
  query: UsageLogQuery,
): boolean {
  if (query.startAt !== undefined && value.createdAt < query.startAt) return false
  if (query.endAt !== undefined && value.createdAt > query.endAt) return false
  if (query.provider !== undefined && value.provider !== query.provider) return false
  if (query.modelId !== undefined && value.modelId !== query.modelId) return false
  return true
}

function createMutableSummary(): MutableSummary {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    successCount: 0,
    errorCount: 0,
  }
}

function addRecord(summary: MutableSummary, record: ChannelUsageRecord): void {
  summary.requestCount += 1
  summary.inputTokens += record.inputTokens
  summary.outputTokens += record.outputTokens
  summary.cacheReadTokens += record.cacheReadTokens
  summary.cacheCreationTokens += record.cacheCreationTokens
  summary.totalTokens += record.totalTokens
  if (record.status === 'success') summary.successCount += 1
  else summary.errorCount += 1
}

function addCost(summary: MutableSummary, cost: CostEvent): void {
  summary.costUsd += cost.costUsd
}

function finishSummary(summary: MutableSummary): ChannelUsageSummary {
  const cacheDenominator = summary.cacheReadTokens
    + summary.cacheCreationTokens
    + summary.inputTokens

  return {
    ...summary,
    successRate: summary.requestCount === 0
      ? 0
      : summary.successCount / summary.requestCount,
    cacheHitRate: cacheDenominator === 0
      ? 0
      : summary.cacheReadTokens / cacheDenominator,
  }
}

function addToGroup<T>(
  groups: Map<string, MutableSummary>,
  key: string,
  value: T,
  add: (summary: MutableSummary, value: T) => void,
): void {
  const summary = groups.get(key) ?? createMutableSummary()
  add(summary, value)
  groups.set(key, summary)
}

function finishGroups(groups: Map<string, MutableSummary>): Record<string, ChannelUsageSummary> {
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, summary]) => [key, finishSummary(summary)]),
  )
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localHourKey(timestamp: number): string {
  return `${String(new Date(timestamp).getHours()).padStart(2, '0')}:00`
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback
}

/**
 * 扫描 Agent session JSONL，并按查询条件返回聚合与分页明细。
 *
 * Token 只累计 assistant.message.usage；费用只累计 result.total_cost_usd。
 */
export function getChannelUsageStats(
  query: UsageLogQuery = {},
  options: ChannelUsageStatsOptions = {},
): ChannelUsageStats {
  const sessionsDir = options.sessionsDir ?? getAgentSessionsDir()
  const now = asTimestamp(options.now) ?? Date.now()
  const scanned = scanUsageDirectory(sessionsDir)
  const records = scanned.records.filter((record) => matchesQuery(record, query))
  const costs = scanned.costs.filter((cost) => matchesQuery(cost, query))
  const todayKey = localDayKey(now)

  const summary = createMutableSummary()
  const byDay = new Map<string, MutableSummary>()
  const byHour = new Map<string, MutableSummary>()
  const byProvider = new Map<string, MutableSummary>()
  const byModel = new Map<string, MutableSummary>()

  for (const record of records) {
    addRecord(summary, record)
    addToGroup(byDay, localDayKey(record.createdAt), record, addRecord)
    addToGroup(byProvider, record.provider, record, addRecord)
    addToGroup(byModel, record.modelId, record, addRecord)
    if (localDayKey(record.createdAt) === todayKey) {
      addToGroup(byHour, localHourKey(record.createdAt), record, addRecord)
    }
  }

  for (const cost of costs) {
    addCost(summary, cost)
    addToGroup(byDay, localDayKey(cost.createdAt), cost, addCost)
    addToGroup(byProvider, cost.provider, cost, addCost)
    addToGroup(byModel, cost.modelId, cost, addCost)
    if (localDayKey(cost.createdAt) === todayKey) {
      addToGroup(byHour, localHourKey(cost.createdAt), cost, addCost)
    }
  }

  records.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
  const page = normalizePositiveInteger(query.page, 1)
  const pageSize = Math.min(normalizePositiveInteger(query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  const start = (page - 1) * pageSize

  return {
    summary: finishSummary(summary),
    byDay: finishGroups(byDay),
    byHour: finishGroups(byHour),
    byProvider: finishGroups(byProvider),
    byModel: finishGroups(byModel),
    records: records.slice(start, start + pageSize),
    totalRecords: records.length,
    page,
    pageSize,
  }
}
