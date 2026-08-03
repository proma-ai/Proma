/**
 * Memory Recall 纯函数单元测试
 *
 * 不依赖磁盘/env，只测纯函数逻辑，确保参与全量测试无并发冲突。
 * 磁盘相关集成测试见 integration.test.ts（PROMA_MEMORY_DIR 隔离）。
 */

import { describe, expect, it } from 'bun:test'
import { ruleBoost, formatRecallContext, queryTerms, expandedQueryTerms } from '../memory/recall'

describe('memory/recall 纯函数', () => {
  it('ruleBoost 身份/偏好加权', () => {
    const identity = ruleBoost({ content: '用户叫 Conrad 是独立开发者', type: 'fact', priority: 50 } as never)
    expect(identity).toBeGreaterThan(0)
    const pref = ruleBoost({ content: '用户喜欢 TypeScript', type: 'preference', priority: 50 } as never)
    expect(pref).toBeGreaterThan(0)
    const neutral = ruleBoost({ content: '普通事实记录', type: 'fact', priority: 30 } as never)
    expect(neutral).toBe(0)
  })

  it('queryTerms 过滤停用词与噪声', () => {
    const terms = queryTerms('帮我写一个排序算法')
    expect(terms.includes('帮')).toBe(false)
    expect(terms.includes('一')).toBe(false)
    expect(terms.includes('排序')).toBe(true)
    expect(terms.includes('算法')).toBe(true)
  })

  it('expandedQueryTerms 同义词扩展', () => {
    const terms = expandedQueryTerms('用什么编程语言')
    expect(terms.some((t) => ['typescript', 'rust', '技术栈'].includes(t))).toBe(true)
  })

  it('formatRecallContext 空结果返回空串', () => {
    const block = formatRecallContext({ query: 'x', hits: [], strategy: 'keyword', durationMs: 1 } as never)
    expect(block).toBe('')
  })

  it('formatRecallContext 渲染命中强度标注', () => {
    const result = {
      query: 'test',
      hits: [{
        atom: { id: 'a1', content: '测试记忆内容', type: 'fact' as const, priority: 60, createdAt: 1000, updatedAt: 1000, confirmed: true },
        score: 0.8,
        matchedTerms: [],
      }],
      strategy: 'keyword' as const,
      durationMs: 1,
    }
    const block = formatRecallContext(result)
    expect(block).toContain('rel=high')
    expect(block).toContain('测试记忆内容')
  })
})
