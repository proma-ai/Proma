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

import { resetSuggestionsCache, setSuggestionsEnabled } from './feedback'
import { evaluateSessionSuggestions, handleSuggestionFeedback, listSuggestionsForUI } from './service'
import { corrections as memoryCorrections } from '../memory/service'

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
})
