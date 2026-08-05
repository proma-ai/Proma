/**
 * Memory Recall 纯函数单元测试
 *
 * 不依赖磁盘/env，只测纯函数逻辑，确保参与全量测试无并发冲突。
 * 磁盘相关集成测试见 integration.test.ts（PROMA_MEMORY_DIR 隔离）。
 */

import { describe, expect, it } from 'bun:test'
import { ruleBoost, formatRecallContext, queryTerms, expandedQueryTerms, timeDecay } from '../memory/recall'

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

  it('queryTerms 闲聊意图词“天气”被过滤，项目名仍可召回', () => {
    // “今天天气怎么样”是闲聊：天气进入停用词，避免命中“天气小程序”项目记忆
    expect(queryTerms('今天天气怎么样').includes('天气')).toBe(false)
    // 但“天气小程序还在维护吗”仍保留小程序/程序/维护等实体词
    const terms = queryTerms('天气小程序还在维护吗')
    expect(terms.includes('小程序') || terms.includes('程序') || terms.includes('维护')).toBe(true)
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

  it('timeDecay：30 天后事实/偏好类权重减半，correction/sop 不衰减', () => {
    const now = Date.now()
    const dayMs = 86_400_000
    const freshFact = { content: '新事实', type: 'fact' as const, priority: 50, createdAt: now - dayMs, updatedAt: now, confirmed: true, id: 'f1' }
    const oldFact = { content: '旧事实', type: 'fact' as const, priority: 50, createdAt: now - 30 * dayMs, updatedAt: now, confirmed: true, id: 'f2' }
    const oldCorrection = { content: '旧规则', type: 'correction' as const, priority: 80, createdAt: now - 30 * dayMs, updatedAt: now, confirmed: true, id: 'c1' }
    const oldSop = { content: '旧流程', type: 'sop' as const, priority: 80, createdAt: now - 30 * dayMs, updatedAt: now, confirmed: true, id: 's1' }

    // 30 天事实：约 0.5；1 天事实：接近 1
    expect(timeDecay(oldFact, now)).toBeLessThanOrEqual(0.55)
    expect(timeDecay(oldFact, now)).toBeGreaterThanOrEqual(0.45)
    expect(timeDecay(freshFact, now)).toBeGreaterThan(0.9)
    // 规则类不衰减
    expect(timeDecay(oldCorrection, now)).toBe(1.0)
    expect(timeDecay(oldSop, now)).toBe(1.0)
  })

  it('timeDecay：event 用更短半衰期（14 天减半，衰减快于普通事实）', () => {
    const now = Date.now()
    const dayMs = 86_400_000
    const oldEvent = { content: '旧事件', type: 'event' as const, priority: 50, createdAt: now - 14 * dayMs, updatedAt: now, confirmed: true, id: 'e1' }
    const oldFact = { content: '旧事实', type: 'fact' as const, priority: 50, createdAt: now - 14 * dayMs, updatedAt: now, confirmed: true, id: 'f14' }

    // 14 天 event ≈ 0.5（比同天数的 fact ≈ 0.72 更低）
    expect(timeDecay(oldEvent, now)).toBeLessThanOrEqual(0.55)
    expect(timeDecay(oldEvent, now)).toBeGreaterThanOrEqual(0.45)
    expect(timeDecay(oldEvent, now)).toBeLessThan(timeDecay(oldFact, now))
  })
})
