import { describe, expect, test } from 'bun:test'
import { applyRules, buildSkillCandidate, automationTitleFromRaw, SOP_CANDIDATE_THRESHOLD } from './rules'
import type { RuleContext } from './types'

function makeCtx(userMessages: string[], overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    userMessages,
    existingAutomationTitles: [],
    existingCorrectionRules: [],
    sopCandidateCount: 0,
    ...overrides,
  }
}

describe('suggest/rules: 纠正规则', () => {
  test('纠正信号生成 correction 建议', () => {
    const matches = applyRules(makeCtx(['以后不要用 var 声明变量']))
    const m = matches.find((x) => x.candidate.kind === 'correction')
    expect(m).toBeDefined()
    expect(m?.candidate.title).toBe('记住这个纠正')
    expect(m?.candidate.action.type).toBe('memory_correction')
  })

  test('已有相同 pending correction 不重复建议', () => {
    const matches = applyRules(
      makeCtx(['以后不要用 var 声明变量'], { existingCorrectionRules: ['不要用 var 声明变量'] }),
    )
    expect(matches.some((x) => x.candidate.kind === 'correction')).toBe(false)
  })
})

describe('suggest/rules: 跟进与自动化规则', () => {
  test('时间表达生成 followup 建议', () => {
    const matches = applyRules(makeCtx(['明天继续这个任务']))
    const m = matches.find((x) => x.candidate.kind === 'followup')
    expect(m).toBeDefined()
    expect(m?.candidate.action.type).toBe('open_automation_create')
  })

  test('周期需求生成 automation 建议', () => {
    const matches = applyRules(makeCtx(['每天自动帮我总结当天工作']))
    const m = matches.find((x) => x.candidate.kind === 'automation')
    expect(m).toBeDefined()
    expect(m?.candidate.action.type).toBe('open_automation_create')
  })

  test('未完成信号打开预填 Todo 表单', () => {
    const matches = applyRules(makeCtx(['这个功能还没做完']))
    const m = matches.find((x) => x.candidate.kind === 'todo')
    expect(m?.candidate.action).toMatchObject({ type: 'open_todo_create', title: '还没做完' })
  })

  test('已有同类 automation 不重复建议', () => {
    const matches = applyRules(
      makeCtx(['每天自动帮我总结当天工作'], { existingAutomationTitles: ['总结当天工作'] }),
    )
    // automationTitleFromRaw('每天自动帮我总结当天工作') → '总结当天工作'
    expect(matches.some((x) => x.candidate.kind === 'automation')).toBe(false)
  })

  test('重复意图生成 automation 建议', () => {
    const matches = applyRules(makeCtx(['帮我总结今天的工作', '帮我总结一下进展']))
    const m = matches.find((x) => x.candidate.kind === 'automation')
    expect(m).toBeDefined()
    expect(m?.candidate.evidence).toContain('重复出现')
  })
})

describe('suggest/rules: skill 候选', () => {
  test('SOP 数量不足时不建议', () => {
    expect(buildSkillCandidate(SOP_CANDIDATE_THRESHOLD - 1)).toBeUndefined()
  })

  test('SOP 数量达标时建议沉淀 Skill', () => {
    const c = buildSkillCandidate(SOP_CANDIDATE_THRESHOLD)
    expect(c).toBeDefined()
    expect(c?.kind).toBe('skill')
    expect(c?.action.type).toBe('open_skill_creator')
  })
})

describe('suggest/rules: 工具函数', () => {
  test('automationTitleFromRaw 提炼标题', () => {
    expect(automationTitleFromRaw('每天自动帮我总结当天工作')).toBe('总结当天工作')
    expect(automationTitleFromRaw('帮我盯一下 release 状态')).toBe('release 状态')
  })
})
