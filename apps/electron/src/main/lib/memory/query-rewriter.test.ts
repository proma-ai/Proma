/**
 * Memory Query Rewriter 单元测试（纯函数）
 */

import { describe, expect, it } from 'bun:test'
import { parseRewriteResponse, ruleExpandQuery } from '../memory/query-rewriter'

describe('memory/query-rewriter 纯函数', () => {
  it('parseRewriteResponse 解析标准 JSON 数组', () => {
    const raw = '["分段锁", "ShopGo订单拆分锁"]'
    const result = parseRewriteResponse(raw)
    expect(result).toEqual(['分段锁', 'ShopGo订单拆分锁'])
  })

  it('parseRewriteResponse 剥离 markdown 围栏', () => {
    const raw = '```json\n["分段锁", "分布式锁"]\n```'
    const result = parseRewriteResponse(raw)
    expect(result).toEqual(['分段锁', '分布式锁'])
  })

  it('parseRewriteResponse 过滤解释性输出', () => {
    const raw = '["ShopGo 的具体锁类型未明确，需提供更多上下文。"]'
    const result = parseRewriteResponse(raw)
    expect(result).toEqual([])
  })

  it('parseRewriteResponse 非 JSON 返回空', () => {
    expect(parseRewriteResponse('不是 JSON')).toEqual([])
    expect(parseRewriteResponse('')).toEqual([])
  })

  it('ruleExpandQuery 锁概念扩展出分段锁', () => {
    const extra = ruleExpandQuery('ShopGo 订单拆分用什么锁？')
    expect(extra).toContain('分段锁')
    expect(extra).toContain('分布式锁')
  })

  it('ruleExpandQuery 工作习惯扩展出 lint/测试', () => {
    const extra = ruleExpandQuery('我有什么工作习惯？')
    expect(extra).toContain('lint')
  })

  it('ruleExpandQuery 无关查询不扩展', () => {
    const extra = ruleExpandQuery('今天天气怎么样')
    expect(extra).toEqual([])
  })
})
