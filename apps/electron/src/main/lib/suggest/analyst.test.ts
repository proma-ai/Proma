import { describe, expect, test } from 'bun:test'
import {
  parseAnalystResponse,
  validateAnalystCandidate,
  validateAnalystCandidates,
} from './analyst'

describe('suggest/analyst: 响应解析', () => {
  test('解析标准 JSON 数组', () => {
    const raw = '[{"kind":"automation","title":"每周发版检查","reason":"你经常手动检查","evidence":"记忆中有多次发版记录","duplicateKey":"automation:每周发版检查","action":{"type":"open_automation_create","automationTitle":"每周发版检查","suggestedPrompt":"每周检查发版状态"}}]'
    const result = parseAnalystResponse(raw)
    expect(result.length).toBe(1)
    expect(result[0]?.kind).toBe('automation')
  })

  test('剥离 markdown 围栏', () => {
    const raw = '```json\n[{"kind":"skill","title":"测试流程","reason":"重复出现","evidence":"多次执行","duplicateKey":"skill:测试流程","action":{"type":"open_skill_creator","topic":"测试流程"}}]\n```'
    const result = parseAnalystResponse(raw)
    expect(result.length).toBe(1)
    expect(result[0]?.kind).toBe('skill')
  })

  test('非 JSON 响应返回空', () => {
    expect(parseAnalystResponse('')).toEqual([])
    expect(parseAnalystResponse('不是 JSON')).toEqual([])
    expect(parseAnalystResponse('[broken')).toEqual([])
    expect(parseAnalystResponse('{"not":"array"}')).toEqual([])
  })

  test('空数组返回空', () => {
    expect(parseAnalystResponse('[]')).toEqual([])
  })
})

describe('suggest/analyst: schema 校验', () => {
  test('合法 automation 候选通过', () => {
    const c = validateAnalystCandidate({
      kind: 'automation',
      title: '每周发版检查',
      reason: '你经常手动检查发版',
      evidence: '记忆中有多次发版记录',
      duplicateKey: 'automation:每周发版检查',
      action: { type: 'open_automation_create', automationTitle: '每周发版检查', suggestedPrompt: '每周检查发版状态' },
    })
    expect(c).not.toBeNull()
    expect(c?.kind).toBe('automation')
    expect(c?.rawConfidence).toBe(0.7)
  })

  test('合法 skill 候选通过', () => {
    const c = validateAnalystCandidate({
      kind: 'skill',
      title: '测试流程',
      reason: '重复出现',
      evidence: '多次执行',
      duplicateKey: 'skill:测试流程',
      action: { type: 'open_skill_creator', topic: '测试流程' },
    })
    expect(c).not.toBeNull()
    expect(c?.kind).toBe('skill')
  })

  test('非法类型被拒绝', () => {
    const c = validateAnalystCandidate({
      kind: 'correction', // analyst 不允许产出 correction
      title: 'x',
      reason: 'y',
      evidence: 'z',
      duplicateKey: 'k',
      action: { type: 'open_memory_board' },
    })
    expect(c).toBeNull()
  })

  test('缺字段被拒绝', () => {
    expect(validateAnalystCandidate({ kind: 'automation', title: '', reason: 'y', evidence: 'z', duplicateKey: 'k', action: { type: 'open_automation_create', automationTitle: 't', suggestedPrompt: 'p' } })).toBeNull()
    expect(validateAnalystCandidate({ kind: 'automation', title: 'x', reason: '', evidence: 'z', duplicateKey: 'k', action: { type: 'open_automation_create', automationTitle: 't', suggestedPrompt: 'p' } })).toBeNull()
    expect(validateAnalystCandidate({ kind: 'automation', title: 'x', reason: 'y', evidence: 'z', duplicateKey: '', action: { type: 'open_automation_create', automationTitle: 't', suggestedPrompt: 'p' } })).toBeNull()
  })

  test('动作类型不匹配被拒绝', () => {
    const c = validateAnalystCandidate({
      kind: 'automation',
      title: 'x',
      reason: 'y',
      evidence: 'z',
      duplicateKey: 'k',
      action: { type: 'open_skill_creator', topic: 't' }, // automation 应配 open_automation_create
    })
    expect(c).toBeNull()
  })

  test('automation 缺 suggestedPrompt 被拒绝', () => {
    const c = validateAnalystCandidate({
      kind: 'automation',
      title: 'x',
      reason: 'y',
      evidence: 'z',
      duplicateKey: 'k',
      action: { type: 'open_automation_create', automationTitle: 't' },
    })
    expect(c).toBeNull()
  })

  test('超长字段被拒绝', () => {
    const c = validateAnalystCandidate({
      kind: 'automation',
      title: 'x'.repeat(50), // > 40
      reason: 'y',
      evidence: 'z',
      duplicateKey: 'k',
      action: { type: 'open_automation_create', automationTitle: 't', suggestedPrompt: 'p' },
    })
    expect(c).toBeNull()
  })
})

describe('suggest/analyst: 候选过滤', () => {
  test('过滤非法候选 + duplicateKey 去重 + 数量上限', () => {
    const raw = [
      { kind: 'automation', title: 'A', reason: 'r', evidence: 'e', duplicateKey: 'dup', action: { type: 'open_automation_create', automationTitle: 't', suggestedPrompt: 'p' } },
      { kind: 'automation', title: 'A2', reason: 'r', evidence: 'e', duplicateKey: 'dup', action: { type: 'open_automation_create', automationTitle: 't2', suggestedPrompt: 'p2' } }, // 同 key
      { kind: 'bad', title: 'B', reason: 'r', evidence: 'e', duplicateKey: 'b', action: { type: 'x' } }, // 非法
      { kind: 'skill', title: 'C', reason: 'r', evidence: 'e', duplicateKey: 'c', action: { type: 'open_skill_creator', topic: 't' } },
      { kind: 'skill', title: 'D', reason: 'r', evidence: 'e', duplicateKey: 'd', action: { type: 'open_skill_creator', topic: 't' } },
      { kind: 'skill', title: 'E', reason: 'r', evidence: 'e', duplicateKey: 'e', action: { type: 'open_skill_creator', topic: 't' } },
    ]
    const result = validateAnalystCandidates(raw as never)
    // dup 去重 → 1 个；bad 过滤；skill 3 个但上限 3 → 共 3 个
    expect(result.length).toBe(3)
    expect(result[0]?.duplicateKey).toBe('dup')
    expect(result.filter((c) => c.kind === 'skill').length).toBe(2)
  })
})
