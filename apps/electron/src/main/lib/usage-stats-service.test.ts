import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getChannelUsageStats } from './usage-stats-service'

interface AssistantFixtureOptions {
  provider?: string
  modelId?: string
  createdAt: number
  input?: number
  output?: number
  cacheRead?: number
  cacheCreation?: number
  includeUsage?: boolean
}

interface ResultFixtureOptions {
  provider?: string
  modelId?: string
  createdAt: number
  cost?: number
  subtype?: string
  durationMs?: number
  includeUsage?: boolean
  usageInput?: number
}

let sessionsDir: string

beforeEach(() => {
  sessionsDir = mkdtempSync(join(tmpdir(), 'proma-usage-stats-'))
})

afterEach(() => {
  rmSync(sessionsDir, { recursive: true, force: true })
})

function assistant(options: AssistantFixtureOptions): Record<string, unknown> {
  const message: Record<string, unknown> = { model: options.modelId ?? 'model-default' }
  if (options.includeUsage !== false) {
    message.usage = {
      input_tokens: options.input ?? 0,
      output_tokens: options.output ?? 0,
      cache_read_input_tokens: options.cacheRead ?? 0,
      cache_creation_input_tokens: options.cacheCreation ?? 0,
    }
  }
  return {
    type: 'assistant',
    message,
    _channelProvider: options.provider,
    _channelModelId: options.modelId,
    _createdAt: options.createdAt,
  }
}

function result(options: ResultFixtureOptions): Record<string, unknown> {
  const row: Record<string, unknown> = {
    type: 'result',
    subtype: options.subtype ?? 'success',
    total_cost_usd: options.cost,
    _channelProvider: options.provider,
    _channelModelId: options.modelId,
    _createdAt: options.createdAt,
    _durationMs: options.durationMs,
  }
  if (options.includeUsage !== false) {
    row.usage = {
      input_tokens: options.usageInput ?? 999,
      output_tokens: 999,
      cache_read_input_tokens: 999,
      cache_creation_input_tokens: 999,
    }
  }
  return row
}

function writeSession(
  sessionId: string,
  rows: Array<Record<string, unknown> | string>,
): void {
  const jsonl = rows
    .map((row) => typeof row === 'string' ? row : JSON.stringify(row))
    .join('\n')
  writeFileSync(join(sessionsDir, `${sessionId}.jsonl`), `${jsonl}\n`, 'utf-8')
}

describe('渠道用量统计', () => {
  test('Given 多 provider、model、day 的 JSONL When 统计 Then 按各维度聚合', () => {
    const firstDay = new Date(2026, 7, 9, 10, 0).getTime()
    const secondDay = new Date(2026, 7, 10, 11, 0).getTime()

    writeSession('session-a', [
      assistant({ provider: 'anthropic', modelId: 'claude-a', createdAt: firstDay, input: 10, output: 2 }),
      result({ provider: 'anthropic', modelId: 'claude-a', createdAt: firstDay, cost: 0.1 }),
    ])
    writeSession('session-b', [
      // 未绑定 ProviderType 联合类型的新 provider 也能原样统计。
      assistant({ provider: 'future-provider', modelId: 'model-b', createdAt: secondDay, input: 20, output: 4 }),
      result({ provider: 'future-provider', modelId: 'model-b', createdAt: secondDay, cost: 0.2 }),
    ])

    const stats = getChannelUsageStats({}, { sessionsDir, now: secondDay })

    expect(stats.summary.requestCount).toBe(2)
    expect(stats.summary.costUsd).toBeCloseTo(0.3)
    expect(stats.byProvider.anthropic?.requestCount).toBe(1)
    expect(stats.byProvider['future-provider']?.requestCount).toBe(1)
    expect(stats.byModel['claude-a']?.totalTokens).toBe(12)
    expect(stats.byModel['model-b']?.totalTokens).toBe(24)
    expect(stats.byDay['2026-08-09']?.requestCount).toBe(1)
    expect(stats.byDay['2026-08-10']?.requestCount).toBe(1)
  })

  test('Given assistant 带 usage When 统计 Then Token 和缓存命中率使用锁定口径', () => {
    const createdAt = new Date(2026, 7, 10, 9, 0).getTime()
    writeSession('tokens', [
      assistant({
        provider: 'openai',
        modelId: 'gpt-test',
        createdAt,
        input: 10,
        output: 5,
        cacheRead: 20,
        cacheCreation: 5,
      }),
    ])

    const stats = getChannelUsageStats({}, { sessionsDir, now: createdAt })

    expect(stats.summary).toMatchObject({
      requestCount: 1,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
      totalTokens: 40,
    })
    expect(stats.summary.cacheHitRate).toBeCloseTo(20 / 35)
  })

  test('Given result 带费用、耗时和失败状态 When 统计 Then 费用来自 result 并回填明细', () => {
    const createdAt = new Date(2026, 7, 10, 12, 0).getTime()
    writeSession('cost', [
      assistant({ provider: 'deepseek', modelId: 'deepseek-test', createdAt, input: 3, output: 2 }),
      result({
        provider: 'deepseek',
        modelId: 'deepseek-test',
        createdAt,
        cost: 0.42,
        durationMs: 1_234,
        subtype: 'error_during_execution',
      }),
    ])

    const stats = getChannelUsageStats({}, { sessionsDir, now: createdAt })

    expect(stats.summary.costUsd).toBeCloseTo(0.42)
    expect(stats.summary.successCount).toBe(0)
    expect(stats.summary.errorCount).toBe(1)
    expect(stats.records[0]).toMatchObject({
      costUsd: 0.42,
      durationMs: 1_234,
      status: 'error',
    })
  })

  test('Given assistant 和 result 都带 usage When 统计 Then result Token 不重复累计', () => {
    const createdAt = new Date(2026, 7, 10, 13, 0).getTime()
    writeSession('no-double-count', [
      assistant({
        provider: 'openai',
        modelId: 'gpt-test',
        createdAt,
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheCreation: 4,
      }),
      result({
        provider: 'openai',
        modelId: 'gpt-test',
        createdAt,
        cost: 0.01,
        usageInput: 10_000,
      }),
    ])

    const stats = getChannelUsageStats({}, { sessionsDir, now: createdAt })

    expect(stats.summary.requestCount).toBe(1)
    expect(stats.summary.totalTokens).toBe(10)
    expect(stats.records[0]?.totalTokens).toBe(10)
  })

  test('Given 老数据缺 usage/provider 且混入坏行 When 统计 Then 安静跳过', () => {
    const createdAt = new Date(2026, 7, 10, 14, 0).getTime()
    writeSession('legacy', [
      assistant({ provider: 'openai', modelId: 'missing-usage', createdAt, includeUsage: false }),
      assistant({ modelId: 'missing-provider', createdAt, input: 100 }),
      '{ 不是合法 JSON',
      result({ provider: 'openai', modelId: 'fee-without-usage', createdAt, cost: 9, includeUsage: false }),
      assistant({ provider: 'openai', modelId: 'valid', createdAt, input: 2, output: 1 }),
    ])

    const stats = getChannelUsageStats({}, { sessionsDir, now: createdAt })

    expect(stats.summary.requestCount).toBe(1)
    expect(stats.summary.totalTokens).toBe(3)
    expect(stats.summary.costUsd).toBe(0)
    expect(stats.records.map((record) => record.modelId)).toEqual(['valid'])
  })

  test('Given 今天与历史小时数据 When 统计 Then byHour 只聚合今天', () => {
    const todayNine = new Date(2026, 7, 10, 9, 10).getTime()
    const todayNineLater = new Date(2026, 7, 10, 9, 50).getTime()
    const todaySeventeen = new Date(2026, 7, 10, 17, 5).getTime()
    const yesterdayNine = new Date(2026, 7, 9, 9, 10).getTime()
    const rows = [todayNine, todayNineLater, todaySeventeen, yesterdayNine].flatMap((createdAt, index) => [
      assistant({ provider: 'openai', modelId: 'hourly', createdAt, input: index + 1 }),
      result({ provider: 'openai', modelId: 'hourly', createdAt, cost: 0.01 }),
    ])
    writeSession('hourly', rows)

    const stats = getChannelUsageStats({}, { sessionsDir, now: todaySeventeen })

    expect(Object.keys(stats.byHour)).toEqual(['09:00', '17:00'])
    expect(stats.byHour['09:00']?.requestCount).toBe(2)
    expect(stats.byHour['09:00']?.costUsd).toBeCloseTo(0.02)
    expect(stats.byHour['17:00']?.requestCount).toBe(1)
    expect(stats.summary.requestCount).toBe(4)
  })

  test('Given provider/model/time 筛选与分页 When 查询 Then 聚合基于全量筛选结果、明细按页返回', () => {
    const first = new Date(2026, 7, 10, 8, 0).getTime()
    const second = new Date(2026, 7, 10, 9, 0).getTime()
    const third = new Date(2026, 7, 10, 10, 0).getTime()
    const fourth = new Date(2026, 7, 10, 11, 0).getTime()
    writeSession('filters', [
      assistant({ provider: 'openai', modelId: 'target', createdAt: first, input: 1 }),
      result({ provider: 'openai', modelId: 'target', createdAt: first, cost: 0.01 }),
      assistant({ provider: 'anthropic', modelId: 'target', createdAt: second, input: 2 }),
      result({ provider: 'anthropic', modelId: 'target', createdAt: second, cost: 0.02 }),
      assistant({ provider: 'openai', modelId: 'target', createdAt: third, input: 3 }),
      result({ provider: 'openai', modelId: 'target', createdAt: third, cost: 0.03 }),
      assistant({ provider: 'openai', modelId: 'other', createdAt: fourth, input: 4 }),
      result({ provider: 'openai', modelId: 'other', createdAt: fourth, cost: 0.04 }),
    ])

    const stats = getChannelUsageStats({
      startAt: first,
      endAt: third,
      provider: 'openai',
      modelId: 'target',
      page: 2,
      pageSize: 1,
    }, { sessionsDir, now: fourth })

    expect(stats.summary.requestCount).toBe(2)
    expect(stats.summary.totalTokens).toBe(4)
    expect(stats.summary.costUsd).toBeCloseTo(0.04)
    expect(stats.totalRecords).toBe(2)
    expect(stats.page).toBe(2)
    expect(stats.pageSize).toBe(1)
    expect(stats.records).toHaveLength(1)
    expect(stats.records[0]).toMatchObject({ createdAt: first, provider: 'openai', modelId: 'target' })
  })
})
