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
})
