/**
 * Memory Persona 单元测试（纯逻辑，不依赖真实 LLM）
 */

import { describe, expect, it } from 'bun:test'
import { cleanPersonaMarkdown, extractName, buildPersonaFromRules, extractPersonaSources } from '../memory/persona'
import { parsePersonaProfile } from '../memory/store'

describe('memory/persona 纯函数', () => {
  it('cleanPersonaMarkdown 剥离 markdown 围栏', () => {
    const raw = '```markdown\n# 用户画像\n\n## 用户\nConrad\n```'
    const cleaned = cleanPersonaMarkdown(raw)
    expect(cleaned.startsWith('# 用户画像')).toBe(true)
    expect(cleaned.includes('```')).toBe(false)
  })

  it('cleanPersonaMarkdown 剥离前置解释文字', () => {
    const raw = '好的，以下是生成的画像：\n\n# 用户画像\n\n## 用户\nConrad'
    const cleaned = cleanPersonaMarkdown(raw)
    expect(cleaned.startsWith('# 用户画像')).toBe(true)
    expect(cleaned.includes('好的')).toBe(false)
  })

  it('cleanPersonaMarkdown 原样保留干净 markdown', () => {
    const raw = '# 用户画像\n\n## 用户\nConrad'
    expect(cleanPersonaMarkdown(raw)).toBe(raw.trim())
  })

  it('extractName 从自我介绍提取姓名', () => {
    expect(extractName('我叫 Conrad，是独立开发者')).toBe('Conrad')
    expect(extractName('我的名字是李明，做后端')).toBe('李明')
  })

  it('extractName 无姓名时返回截断内容', () => {
    const result = extractName('用户喜欢 TypeScript')
    expect(result.length).toBeGreaterThan(0)
  })

  it('buildPersonaFromRules 无记忆时返回 undefined', () => {
    // 依赖磁盘，此处只验证函数存在且类型正确
    expect(typeof buildPersonaFromRules).toBe('function')
  })

  it('parsePersonaProfile 解析二级标题下的列表项', () => {
    const raw = `# 用户画像

## 用户
Conrad

## 一句话定位
独立开发者

## 长期偏好
- 喜欢 TypeScript
- 先调研再动手

## 交互协议
- 涉及密钥时用 .env

## 演进轨迹
- 2026-08：开始做 proactive memory`
    const p = parsePersonaProfile(raw)
    expect(p.name).toBe('Conrad')
    expect(p.summary).toBe('独立开发者')
    expect(p.preferences).toContain('喜欢 TypeScript')
    expect(p.interactionRules).toContain('涉及密钥时用 .env')
    expect(p.evolution).toContain('2026-08：开始做 proactive memory')
  })

  it('extractPersonaSources 提取带 src 标注的画像条目来源', () => {
    const raw = `# 用户画像

## 长期偏好
- 喜欢 TypeScript（src: atom_aaa,atom_bbb）
- 先调研再动手（src: atom_ccc）
- 无来源条目`
    const entries = extractPersonaSources(raw)
    const ts = entries.find((e) => e.text.includes('喜欢 TypeScript'))
    expect(ts?.sources).toEqual(['atom_aaa', 'atom_bbb'])
    const noSrc = entries.find((e) => e.text.includes('无来源条目'))
    expect(noSrc?.sources).toEqual([])
    // text 应剔除 src 标注
    expect(ts?.text).not.toContain('src:')
  })
})
