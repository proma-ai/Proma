/**
 * Memory Extractor 单元测试（纯逻辑，不依赖真实 LLM）
 */

import { describe, expect, it } from 'bun:test'
import { parseExtractionResponse, formatExtractionMessages } from '../memory/extractor'

describe('memory/extractor 解析', () => {
  it('解析标准 JSON 数组', () => {
    const raw = '[{"content": "用户使用 DeepSeek", "type": "fact", "priority": 70}]'
    const result = parseExtractionResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.content).toBe('用户使用 DeepSeek')
    expect(result[0]?.type).toBe('fact')
    expect(result[0]?.priority).toBe(70)
  })

  it('解析带 markdown 围栏的响应', () => {
    const raw = '```json\n[{"content": "偏好中文", "type": "preference", "priority": 60}]\n```'
    const result = parseExtractionResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.type).toBe('preference')
  })

  it('过滤空 content，非法类型降级为 fact', () => {
    const raw = JSON.stringify([
      { content: '', type: 'fact', priority: 50 },
      { content: '有效记忆', type: 'hack', priority: 100 },
      { content: '正确类型', type: 'sop', priority: 80 },
    ])
    const result = parseExtractionResponse(raw)
    expect(result).toHaveLength(2)
    expect(result[0]?.type).toBe('fact') // 非法 hack 降级为 fact
    expect(result[0]?.priority).toBe(100)
    expect(result[1]?.type).toBe('sop')
    expect(result[1]?.priority).toBe(80)
  })

  it('priority 越界时钳制到 0-100', () => {
    const raw = '[{"content": "x", "type": "fact", "priority": 999}, {"content": "y", "type": "fact", "priority": -5}]'
    const result = parseExtractionResponse(raw)
    expect(result[0]?.priority).toBe(100)
    expect(result[1]?.priority).toBe(0)
  })

  it('非 JSON 响应返回空数组', () => {
    expect(parseExtractionResponse('不是 JSON')).toEqual([])
    expect(parseExtractionResponse('')).toEqual([])
    expect(parseExtractionResponse('[not valid')).toEqual([])
  })

  it('formatExtractionMessages 截断超长消息', () => {
    const long = 'x'.repeat(2000)
    const text = formatExtractionMessages([{ role: 'user', content: long }])
    expect(text.length).toBeLessThan(1200)
  })
})
