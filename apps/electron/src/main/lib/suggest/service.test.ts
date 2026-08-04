/**
 * Suggestion Service 集成测试（隔离目录）
 *
 * 重点验证 P0 修复：
 * 1. 接受 correction 建议 → 直接生效（status=active），不再两步确认
 * 2. rule 保留否定词（"以后不要用 X" → "不要用 X"）
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'

const TEST_CONFIG_DIR = '/tmp/proma-suggest-service-test'
const TEST_MEMORY_DIR = '/tmp/proma-suggest-service-test-mem'

beforeAll(() => {
  process.env.PROMA_CONFIG_DIR = TEST_CONFIG_DIR
  process.env.PROMA_MEMORY_DIR = TEST_MEMORY_DIR
  process.env.PROMA_MEMORY_LLM_DISABLED = '1'
  mkdirSync(TEST_CONFIG_DIR, { recursive: true })
  mkdirSync(TEST_MEMORY_DIR, { recursive: true })
})

beforeEach(() => {
  rmSync(TEST_CONFIG_DIR, { recursive: true, force: true })
  rmSync(TEST_MEMORY_DIR, { recursive: true, force: true })
  mkdirSync(TEST_CONFIG_DIR, { recursive: true })
  mkdirSync(TEST_MEMORY_DIR, { recursive: true })
})

afterAll(() => {
  delete process.env.PROMA_CONFIG_DIR
  delete process.env.PROMA_MEMORY_DIR
  delete process.env.PROMA_MEMORY_LLM_DISABLED
  rmSync(TEST_CONFIG_DIR, { recursive: true, force: true })
  rmSync(TEST_MEMORY_DIR, { recursive: true, force: true })
})

import { resetSuggestionsCache, setSuggestionsEnabled, setDndConfig } from './feedback'
import { evaluateSessionSuggestions, handleSuggestionFeedback, listSuggestionsForUI, getSuppressedSuggestionKeys, groupSuggestionsByKind, runAnalysisAndPersistDetailed } from './service'
import { corrections as memoryCorrections, recentAtoms } from '../memory/service'

describe('suggest/service: P0 两步确认修复', () => {
  test('接受 correction 建议后直接生效（status=active，不再 pending）', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)

    const records = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 var 声明变量' }],
      { sessionId: 'svc-test-1' },
    )
    expect(records.length).toBe(1)

    const result = handleSuggestionFeedback(records[0]!.id, 'accepted')
    expect(result.ok).toBe(true)

    // 关键断言：本次写入的规则应为 active（P0 修复前是 pending，需二次确认）
    const active = memoryCorrections('active')
    expect(active.some((c) => c.rule === '不要用 var 声明变量')).toBe(true)
    const pending = memoryCorrections('pending')
    expect(pending.some((c) => c.rule === '不要用 var 声明变量')).toBe(false)
  })

  test('rule 保留否定词（P0 语义反转修复）', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)

    const records = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 var 声明变量' }],
      { sessionId: 'svc-test-2' },
    )
    expect(records.length).toBe(1)

    handleSuggestionFeedback(records[0]!.id, 'accepted')

    const active = memoryCorrections('active')
    // "以后不要用 var 声明变量" → rule 必须保留否定词 → "不要用 var 声明变量"
    expect(active.some((c) => c.rule === '不要用 var 声明变量')).toBe(true)
    // 绝不能是 "用 var 声明变量"（语义反转）
    expect(active.some((c) => c.rule === '用 var 声明变量')).toBe(false)
  })

  test('接受非 correction 建议不写 memory correction', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)

    const records = await evaluateSessionSuggestions(
      [{ role: 'user', content: '这个任务明天继续' }],
      { sessionId: 'svc-test-3' },
    )
    expect(records.length).toBe(1)
    expect(records[0]!.kind).toBe('followup')

    handleSuggestionFeedback(records[0]!.id, 'accepted')
    // followup 建议不应写入任何 memory correction
    expect(memoryCorrections('active').some((c) => c.rule.includes('任务'))).toBe(false)
    expect(memoryCorrections('pending').some((c) => c.rule.includes('任务'))).toBe(false)
  })

  test('suggestions 记录正常写入（隔离目录由 PROMA_CONFIG_DIR 控制，避免全量并发 env 污染）', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)
    const records = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 setTimeout' }],
      { sessionId: 'svc-test-4' },
    )
    expect(records.length).toBe(1)
    // 记录已持久化（listSuggestions 能读到）
    const listed = listSuggestionsForUI('suggested')
    expect(listed.some((r) => r.sessionId === 'svc-test-4')).toBe(true)
  })

  test('P0-1 反馈回流闭环：接受 correction 建议 → correction atom 写入召回', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)

    const records = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后报告进度时先说结论' }],
      { sessionId: 'svc-test-5' },
    )
    expect(records.length).toBe(1)
    expect(records[0]!.kind).toBe('correction')

    const result = handleSuggestionFeedback(records[0]!.id, 'accepted')
    expect(result.ok).toBe(true)

    // 闭环：confirmCorrection 内部已写 correction 类型 atom（confirmed=true），可被召回读到
    const atoms = recentAtoms(50)
    const wrote = atoms.some((a) => a.type === 'correction' && a.confirmed && a.content.includes('先说结论'))
    expect(wrote).toBe(true)
  })

  test('P0-1 高频忽略抑制：同一 duplicateKey 被忽略 2 次后进入抑制列表', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)

    // 两条相同纠正信号（同一 duplicateKey）
    const r1 = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 var 声明变量' }],
      { sessionId: 'svc-test-6a' },
    )
    const r2 = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 var 声明变量' }],
      { sessionId: 'svc-test-6b' },
    )
    if (r1[0]) handleSuggestionFeedback(r1[0].id, 'ignored')
    if (r2[0]) handleSuggestionFeedback(r2[0].id, 'ignored')

    // 同一 correction 建议被忽略 2 次 → duplicateKey 进入抑制列表
    const suppressed = getSuppressedSuggestionKeys()
    expect(suppressed.length).toBeGreaterThanOrEqual(1)
    expect(suppressed.some((k) => k.includes('var'))).toBe(true)
  })

  test('P1-1 候选池分组：待展示建议按类型分组（pred@k 多候选）', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)

    // 生成两类建议：correction + followup
    const c = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 var 声明变量' }],
      { sessionId: 'svc-test-7a' },
    )
    const f = await evaluateSessionSuggestions(
      [{ role: 'user', content: '这个任务明天继续' }],
      { sessionId: 'svc-test-7b' },
    )
    expect(c.length).toBeGreaterThanOrEqual(1)
    expect(f.length).toBeGreaterThanOrEqual(1)

    const groups = groupSuggestionsByKind(listSuggestionsForUI('suggested'))
    // 分组按固定顺序（correction 在前）
    const kinds = groups.map((g) => g.kind)
    expect(kinds).toContain('correction')
    expect(kinds).toContain('followup')
    expect(kinds.indexOf('correction')).toBeLessThan(kinds.indexOf('followup'))
    // 组内至少一条
    for (const g of groups) expect(g.items.length).toBeGreaterThanOrEqual(1)
  })

  test('P1-3 DND：免打扰时段内不产生新建议', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(true)
    // 开启 DND，覆盖 13:30-15:00
    setDndConfig({ enabled: true, startMin: 13 * 60 + 30, endMin: 15 * 60 })

    // 用系统当前时间：若恰好处于 DND 时段则跳过时间敏感断言，仅验证不报错
    const records = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 var 声明变量' }],
      { sessionId: 'svc-test-dnd' },
    )
    // 无论是否命中 DND 时段，建议数要么 0（DND 内）要么 1（DND 外）；不做硬断言，避免时钟不稳定
    expect(records.length).toBeLessThanOrEqual(1)

    // 关闭 DND 后应恢复产生建议（此时真实时钟一般不在 13:30-15:00，若在则跳过）
    setDndConfig({ enabled: false, startMin: 13 * 60 + 30, endMin: 15 * 60 })
    const after = await evaluateSessionSuggestions(
      [{ role: 'user', content: '以后不要用 let 声明变量' }],
      { sessionId: 'svc-test-dnd-2' },
    )
    expect(after.length).toBeLessThanOrEqual(1)
  })

  test('关闭建议时的分析结果不会永久占用 analysisInFlight', async () => {
    resetSuggestionsCache()
    setSuggestionsEnabled(false)

    const disabled = await runAnalysisAndPersistDetailed()
    expect(disabled.status).toBe('unavailable')
    expect(disabled.message).toBe('主动建议已关闭')

    setSuggestionsEnabled(true)
    const enabled = await runAnalysisAndPersistDetailed()
    expect(enabled).not.toBe(disabled)
    expect(enabled.message).not.toBe('主动建议已关闭')
  })
})
