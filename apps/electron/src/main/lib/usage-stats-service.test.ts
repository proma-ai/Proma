/**
 * 用量统计服务单测
 *
 * 覆盖：消息解析、assistant/result 口径、result 兜底、日期分桶、
 * 增量指纹（不变不重扫 / 变更重扫 / 删除 detach）、快照聚合。
 * 全部使用临时目录，不触碰真实 ~/.proma。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyIncrementalScan,
  buildSnapshot,
  localDayKey,
  parseUsageLine,
  scanSessionFile,
  type UsageStatsCacheFile,
} from './usage-stats-service'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'proma-usage-stats-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeSession(id: string, lines: string[]): string {
  const filePath = join(tempDir, `${id}.jsonl`)
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
  return filePath
}

function assistantLine(ts: number, provider: string, model: string, usage: Record<string, number> | null): string {
  const msg: Record<string, unknown> = {
    type: 'assistant',
    _createdAt: ts,
    _channelProvider: provider,
    _channelModelId: model,
    message: {},
  }
  if (usage) msg.message = { model, usage }
  return JSON.stringify(msg)
}

function resultLine(ts: number, provider: string, model: string, usage: Record<string, number> | null, costUsd = 0): string {
  const msg: Record<string, unknown> = {
    type: 'result',
    _createdAt: ts,
    _channelProvider: provider,
    _channelModelId: model,
    subtype: 'success',
    usage,
    total_cost_usd: costUsd,
  }
  return JSON.stringify(msg)
}

function emptyCache(): UsageStatsCacheFile {
  return { version: 1, lastScannedAt: 0, sessions: {}, days: {} }
}

describe('parseUsageLine', () => {
  test('解析 assistant 消息的 token usage', () => {
    const line = assistantLine(1_750_000_000_000, 'deepseek', 'deepseek-v3', {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 5,
    })
    const parsed = parseUsageLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.isResult).toBe(false)
    expect(parsed!.provider).toBe('deepseek')
    expect(parsed!.model).toBe('deepseek-v3')
    expect(parsed!.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 5,
    })
    expect(parsed!.costUsd).toBe(0)
  })

  test('解析 result 消息的聚合 usage 与 cost', () => {
    const line = resultLine(
      1_750_000_000_000,
      'ark-coding-plan',
      'glm-5.2',
      { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      0.05,
    )
    const parsed = parseUsageLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.isResult).toBe(true)
    expect(parsed!.costUsd).toBe(0.05)
    expect(parsed!.usage!.inputTokens).toBe(1000)
  })

  test('usage 全零视为无 usage', () => {
    const line = assistantLine(1_750_000_000_000, 'p', 'm', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
    const parsed = parseUsageLine(line)
    expect(parsed!.usage).toBeNull()
  })

  test('坏行返回 null，字段缺失兜底 unknown', () => {
    expect(parseUsageLine('{bad json')).toBeNull()
    expect(parseUsageLine('hello')).toBeNull()
    const parsed = parseUsageLine(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, _createdAt: 1000 }))
    expect(parsed).toBeNull()
  })
})

describe('scanSessionFile', () => {
  const DAY = 1_750_000_000_000 // 落在某一天

  test('assistant 为主口径：token 按 assistant，cost/runs 按 result', () => {
    const filePath = writeSession('s1', [
      assistantLine(DAY, 'deepseek', 'deepseek-v3', { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      assistantLine(DAY, 'deepseek', 'deepseek-v3', { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      resultLine(DAY - 86_400_000, 'deepseek', 'deepseek-v3', { input_tokens: 999, output_tokens: 999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 0.08),
    ])
    const days = scanSessionFile(filePath)
    // result 的 token 不应被计入（assistant 有 usage 时）
    const dayKey = localDayKey(DAY)
    expect(days[dayKey]!.tokens.inputTokens).toBe(150)
    expect(days[dayKey]!.tokens.outputTokens).toBe(15)
    // assistant 不计 runs/cost；result 消息归到它自己的日期（前一天）
    expect(days[dayKey]!.runs).toBe(0)
    expect(days[dayKey]!.costUsd).toBe(0)
    const prevKey = localDayKey(DAY - 86_400_000)
    expect(days[prevKey]!.tokens.inputTokens).toBe(0)
    expect(days[prevKey]!.runs).toBe(1)
    expect(days[prevKey]!.costUsd).toBe(0.08)
  })

  test('整个会话无 assistant usage 时用 result 聚合兜底计 token', () => {
    const filePath = writeSession('s2', [
      resultLine(DAY, 'ark', 'glm-5.2', { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 0.03),
      resultLine(DAY, 'ark', 'glm-5.2', { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 0.01),
    ])
    const days = scanSessionFile(filePath)
    const dayKey = localDayKey(DAY)
    expect(days[dayKey]!.tokens.inputTokens).toBe(700)
    expect(days[dayKey]!.tokens.outputTokens).toBe(70)
    expect(days[dayKey]!.runs).toBe(2)
    expect(days[dayKey]!.costUsd).toBe(0.04)
  })

  test('多 provider/model 拆分聚合', () => {
    const filePath = writeSession('s3', [
      assistantLine(DAY, 'openai', 'gpt-4o', { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      assistantLine(DAY, 'deepseek', 'deepseek-v3', { input_tokens: 20, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ])
    const days = scanSessionFile(filePath)
    const dayKey = localDayKey(DAY)
    const providers = Object.keys(days[dayKey]!.providers).sort()
    expect(providers).toEqual(['deepseek', 'openai'])
    expect(days[dayKey]!.providers.openai!.models['gpt-4o']!.tokens.inputTokens).toBe(10)
    expect(days[dayKey]!.providers.deepseek!.models['deepseek-v3']!.tokens.inputTokens).toBe(20)
  })
})

describe('applyIncrementalScan', () => {
  test('指纹不变不重扫；文件变更后重扫更新', () => {
    const filePath = writeSession('s1', [
      assistantLine(1_750_000_000_000, 'p', 'm', { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ])
    const cache = emptyCache()
    expect(applyIncrementalScan(cache, tempDir)).toBe(1)
    expect(buildSnapshot(cache).totals.tokens.inputTokens).toBe(100)

    // 第二次不变 → 不重扫
    expect(applyIncrementalScan(cache, tempDir)).toBe(0)
    expect(buildSnapshot(cache).totals.tokens.inputTokens).toBe(100)

    // 追加一行 → 重扫并更新
    writeFileSync(filePath, filePath + '', 'utf-8') // 占位（下面会重写）
    // 直接重写文件内容（size/mtime 都变化）
    const fs = require('node:fs') as typeof import('node:fs')
    fs.writeFileSync(
      filePath,
      [
        assistantLine(1_750_000_000_000, 'p', 'm', { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
        assistantLine(1_750_000_000_000, 'p', 'm', { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      ].join('\n') + '\n',
      'utf-8',
    )
    expect(applyIncrementalScan(cache, tempDir)).toBe(1)
    expect(buildSnapshot(cache).totals.tokens.inputTokens).toBe(150)
  })

  test('会话文件删除后从缓存 detach', () => {
    const filePath = writeSession('s1', [
      assistantLine(1_750_000_000_000, 'p', 'm', { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ])
    const cache = emptyCache()
    applyIncrementalScan(cache, tempDir)
    expect(buildSnapshot(cache).totals.tokens.inputTokens).toBe(100)

    rmSync(filePath)
    applyIncrementalScan(cache, tempDir)
    expect(buildSnapshot(cache).totals.tokens.inputTokens).toBe(0)
    expect(buildSnapshot(cache).totals.sessions).toBe(0)
  })

  test('多会话聚合到同一快照', () => {
    writeSession('a', [assistantLine(1_750_000_000_000, 'p', 'm', { input_tokens: 30, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })])
    writeSession('b', [assistantLine(1_750_000_000_000, 'p', 'm', { input_tokens: 70, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })])
    const cache = emptyCache()
    applyIncrementalScan(cache, tempDir)
    const snap = buildSnapshot(cache)
    expect(snap.totals.sessions).toBe(2)
    expect(snap.totals.tokens.inputTokens).toBe(100)
    expect(snap.daily).toHaveLength(1)
    expect(snap.daily[0]!.tokens.inputTokens).toBe(100)
  })

  test('breakdownDaily 按天×渠道×模型展开，增量重扫后正确更新且不重复', () => {
    const day1 = new Date(2026, 7, 19, 12, 0, 0).getTime()
    const day2 = new Date(2026, 7, 20, 12, 0, 0).getTime()
    writeSession('a', [
      assistantLine(day1, 'openai', 'gpt-4o', { input_tokens: 30, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      assistantLine(day2, 'deepseek', 'deepseek-v3', { input_tokens: 40, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ])
    const fileB = writeSession('b', [
      assistantLine(day1, 'openai', 'gpt-4o', { input_tokens: 70, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ])
    const cache = emptyCache()
    applyIncrementalScan(cache, tempDir)
    let snap = buildSnapshot(cache)
    expect(snap.breakdownDaily).toHaveLength(2)
    const rowOf = (day: string, provider: string, model: string) =>
      snap.breakdownDaily.find((r) => r.day === day && r.provider === provider && r.model === model)
    expect(rowOf('2026-08-19', 'openai', 'gpt-4o')!.tokens.inputTokens).toBe(100)
    expect(rowOf('2026-08-20', 'deepseek', 'deepseek-v3')!.tokens.inputTokens).toBe(40)

    // 会话 b 挪到第二天 → detach+attach 后明细同步、无重复残留
    writeFileSync(
      fileB,
      [assistantLine(day2, 'openai', 'gpt-4o', { input_tokens: 70, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })].join('\n') + '\n',
      'utf-8',
    )
    applyIncrementalScan(cache, tempDir)
    snap = buildSnapshot(cache)
    expect(snap.breakdownDaily).toHaveLength(3)
    expect(rowOf('2026-08-19', 'openai', 'gpt-4o')!.tokens.inputTokens).toBe(30)
    expect(rowOf('2026-08-20', 'openai', 'gpt-4o')!.tokens.inputTokens).toBe(70)
    // 明细合计与总量守恒
    const detailInput = snap.breakdownDaily.reduce((sum, r) => sum + r.tokens.inputTokens, 0)
    expect(detailInput).toBe(snap.totals.tokens.inputTokens)
  })
})

describe('localDayKey', () => {
  test('按本地日期生成 yyyy-mm-dd', () => {
    const d = new Date(2026, 7, 19, 12, 0, 0) // 2026-08-19 12:00 本地时间
    expect(localDayKey(d.getTime())).toBe('2026-08-19')
    const edge = new Date(2026, 0, 5, 0, 0, 0)
    expect(localDayKey(edge.getTime())).toBe('2026-01-05')
  })
})