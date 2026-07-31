import { describe, expect, test } from 'bun:test'
import { createFallbackTitle, sanitizeGeneratedTitle } from './title-generation'

describe('标题生成辅助逻辑', () => {
  test('Given ChatGPT OAuth 无标题适配器 When 本地兜底 Then 使用首个有效行并限制长度', () => {
    const title = createFallbackTitle('\n\n## 帮我修复 OpenAI OAuth 标题生成失败的问题\n更多细节')

    expect(title).toBe('帮我修复 OpenAI OAuth 标题')
  })

  test('Given 模型返回带引号标题 When 清理 Then 去除包裹符号并限制长度', () => {
    const title = sanitizeGeneratedTitle('「OpenAI OAuth 标题修复」')

    expect(title).toBe('OpenAI OAuth 标题修复')
  })

  test('Given 模型返回内容块数组标题 When 清理 Then 拼接文本并限制长度', () => {
    const title = sanitizeGeneratedTitle([
      { type: 'text', text: '「OpenCode Go 标题' },
      { type: 'text', text: '修复」' },
    ])

    expect(title).toBe('OpenCode Go 标题修复')
  })

  test('Given 模型返回含非文本块的内容数组 When 清理 Then 忽略非文本块', () => {
    const title = sanitizeGeneratedTitle([
      { type: 'thinking', thinking: '这是推理内容，不应成为标题' },
      { type: 'text', text: 'OpenCode 标题修复' },
    ])

    expect(title).toBe('OpenCode 标题修复')
  })

  test('Given 模型返回对象形式内容 When 清理 Then 提取 text 字段', () => {
    const title = sanitizeGeneratedTitle({ type: 'text', text: 'OpenCode 标题修复' })

    expect(title).toBe('OpenCode 标题修复')
  })

  test('Given 模型返回空数组/空对象 When 清理 Then 返回 null', () => {
    expect(sanitizeGeneratedTitle([])).toBeNull()
    expect(sanitizeGeneratedTitle({ type: 'text' })).toBeNull()
    expect(sanitizeGeneratedTitle(null)).toBeNull()
    expect(sanitizeGeneratedTitle(undefined)).toBeNull()
  })
})
