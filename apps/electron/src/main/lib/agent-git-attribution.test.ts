import { describe, expect, test } from 'bun:test'
import {
  PROMA_COMMIT_TRAILER,
  PROMA_PR_ATTRIBUTION,
  buildGitAttributionPromptSection,
} from './agent-git-attribution'

describe('Git / PR 标识提示词', () => {
  test('Given 标识开启 When 构建规则 Then 保留唯一 trailer、PR footer 与禁止 co-author', () => {
    const prompt = buildGitAttributionPromptSection(true)

    expect(prompt).toContain(PROMA_COMMIT_TRAILER)
    expect(prompt).toContain(PROMA_PR_ATTRIBUTION)
    expect(prompt).toContain('不要使用 `Co-Authored-By`')
    expect(prompt.length).toBeLessThanOrEqual(700)
  })

  test('Given 标识关闭 When 构建规则 Then 禁止自动添加归因', () => {
    const prompt = buildGitAttributionPromptSection(false)

    expect(prompt).toContain('不要添加任何 Proma 归因')
    expect(prompt).not.toContain(PROMA_COMMIT_TRAILER)
  })
})
