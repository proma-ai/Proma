/**
 * Memory Store 单元测试
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 注意：store/recall 的磁盘相关函数依赖真实 config-paths（~/.proma/memory），
// 单测避免写入用户目录，因此只测不依赖磁盘的纯函数。
import { fingerprintContent, isDuplicate, localDateKey } from '../memory/store'
import { tokenize, queryTerms, expandedQueryTerms, RECALL_MIN_SCORE } from '../memory/recall'

describe('memory/store 纯函数', () => {
  it('localDateKey 返回 YYYY-MM-DD', () => {
    const key = localDateKey(new Date('2026-08-02T12:00:00').getTime())
    expect(key).toBe('2026-08-02')
  })

  it('fingerprintContent 归一化空白与标点', () => {
    expect(fingerprintContent('用户 喜欢 用中文')).toBe(fingerprintContent('用户喜欢用中文'))
    expect(fingerprintContent('用 Python 写脚本。')).toBe(fingerprintContent('用Python写脚本'))
  })

  it('isDuplicate 判定实质重复', () => {
    const a = { content: '用户使用 DeepSeek 作为默认模型', fingerprint: fingerprintContent('用户使用 DeepSeek 作为默认模型') } as never
    const b = { content: '用户使用 DeepSeek 作为默认模型。', fingerprint: fingerprintContent('用户使用 DeepSeek 作为默认模型。') } as never
    expect(isDuplicate(a as never, b as never)).toBe(true)
  })

  it('isDuplicate 区分不同内容', () => {
    const a = { content: '用户喜欢咖啡', fingerprint: fingerprintContent('用户喜欢咖啡') } as never
    const b = { content: '用户喜欢喝茶', fingerprint: fingerprintContent('用户喜欢喝茶') } as never
    expect(isDuplicate(a as never, b as never)).toBe(false)
  })
})

describe('memory/recall 分词与检索', () => {
  it('tokenize 提取英文单词与中文 bigram', () => {
    const tokens = tokenize('用 Python 写脚本')
    expect(tokens).toContain('python')
    expect(tokens).toContain('脚本')
    expect(tokens).toContain('写脚')
  })

  it('queryTerms 去重', () => {
    const terms = queryTerms('喜欢 喜欢 咖啡')
    expect(new Set(terms).size).toBe(terms.length)
  })

  it('queryTerms 过滤停用词（防误报）', () => {
    // 全功能词查询应没有“帮/我/写/一/个”等纯噪声词，但保留有语义的 bigram（排序/算法）
    const terms = queryTerms('帮我写一个排序算法')
    expect(terms.includes('帮')).toBe(false)
    expect(terms.includes('一')).toBe(false)
    expect(terms.includes('排序')).toBe(true)
    expect(terms.includes('算法')).toBe(true)
  })

  it('expandedQueryTerms 同义词扩展（编程→技术栈）', () => {
    const terms = expandedQueryTerms('用什么编程语言')
    // 扩展后应包含技术栈相关词
    expect(terms.some((t) => ['typescript', 'rust', '技术栈'].includes(t))).toBe(true)
  })

  it('RECALL_MIN_SCORE 阈值存在且在合理区间', () => {
    expect(RECALL_MIN_SCORE).toBeGreaterThan(0)
    expect(RECALL_MIN_SCORE).toBeLessThan(0.5)
  })
})
