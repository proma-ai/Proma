/**
 * Memory Store 磁盘集成测试
 *
 * 通过 PROMA_MEMORY_DIR 环境变量把记忆根目录指向临时目录，
 * 验证真实磁盘读写（不依赖 LLM / service mock）。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// bun 的 mock.module 是全局副作用：agent-prompt-builder.test.ts 会把 config-paths 的
// memory 函数 mock 到 /tmp/proma-test-config/memory。集成测试与它共用同一路径，
// 保证全量并发时路径一致。只验证“写盘可回读”，不依赖具体目录值。
const memRoot = '/tmp/proma-test-config/memory'

beforeAll(() => {
  process.env.PROMA_MEMORY_DIR = memRoot
})

beforeEach(() => {
  // 每个用例前清空隔离目录，避免残留数据影响判重/统计
  rmSync(memRoot, { recursive: true, force: true })
})

afterAll(() => {
  delete process.env.PROMA_MEMORY_DIR
  rmSync('/tmp/proma-test-config', { recursive: true, force: true })
})

let store: typeof import('../memory/store')

beforeAll(async () => {
  store = await import('../memory/store')
})

describe('memory/store 磁盘集成（隔离目录）', () => {
  it('writeAtom + readAllAtoms 落盘可回读', () => {
    const atom = store.writeAtom({ content: '集成测试记忆', type: 'fact', priority: 60 })
    const all = store.readAllAtoms({ includeUnconfirmed: true })
    expect(all.some((a) => a.id === atom.id)).toBe(true)
    const dayFile = store.localDateKey()
    expect(existsSync(join(memRoot, 'atoms', `${dayFile}.jsonl`))).toBe(true)
  })

  it('writeAtomWithDedup 重复内容合并', () => {
    const first = store.writeAtomWithDedup({ content: '用户喜欢中文回复', type: 'preference', priority: 50 })
    const second = store.writeAtomWithDedup({ content: '用户喜欢中文回复。', type: 'preference', priority: 80 })
    expect(first.deduplicated).toBe(false)
    expect(second.deduplicated).toBe(true)
    expect(second.atom.id).toBe(first.atom.id)
    expect(second.atom.priority).toBeGreaterThanOrEqual(first.atom.priority)
  })

  it('addCorrection + list + update 状态流转', () => {
    const correction = store.addCorrection({ raw: '测试纠正', rule: '测试规则' })
    expect(store.listCorrections('pending').some((c) => c.id === correction.id)).toBe(true)
    store.updateCorrectionStatus(correction.id, 'active')
    expect(store.listCorrections('active').some((c) => c.id === correction.id)).toBe(true)
    expect(store.listCorrections('pending').some((c) => c.id === correction.id)).toBe(false)
  })

  it('writePersona + readPersonaRaw + parsePersonaProfile', () => {
    store.writePersona('# 用户画像\n\n## 用户\nConrad\n\n## 长期偏好\n- 喜欢 TypeScript')
    const raw = store.readPersonaRaw()
    expect(raw).toContain('Conrad')
    const profile = store.parsePersonaProfile(raw)
    expect(profile.name).toBe('Conrad')
    expect(profile.preferences).toContain('喜欢 TypeScript')
  })

  it('getMemoryStats 汇总统计（rootDir 指向隔离目录）', () => {
    store.writeAtom({ content: '统计测试记忆', type: 'fact', priority: 50 })
    const stats = store.getMemoryStats()
    expect(stats.atomCount).toBeGreaterThan(0)
    expect(typeof stats.pendingCorrections).toBe('number')
    expect(typeof stats.pendingAtoms).toBe('number')
    expect(stats.rootDir).toBe(memRoot)
  })

  it('pending atom 流转：提取默认 pending → 确认生效 / 拒绝删除', () => {
    const atom = store.writeAtom({ content: '自动提取记忆', type: 'fact', priority: 50, confirmed: false })
    // 默认不被读入 confirmed
    expect(store.readAllAtoms().some((a) => a.id === atom.id)).toBe(false)
    expect(store.readAllAtoms({ includeUnconfirmed: true }).some((a) => a.id === atom.id)).toBe(true)
    // 出现在待确认列表
    expect(store.listPendingAtoms().some((a) => a.id === atom.id)).toBe(true)
    // 确认后生效
    const confirmed = store.confirmAtom(atom.id)
    expect(confirmed?.confirmed).toBe(true)
    expect(store.readAllAtoms().some((a) => a.id === atom.id)).toBe(true)
    // 拒绝删除
    const atom2 = store.writeAtom({ content: '要被拒绝的记忆', type: 'preference', priority: 50, confirmed: false })
    expect(store.deleteAtom(atom2.id)).toBe(true)
    expect(store.getAtomById(atom2.id)).toBeUndefined()
  })

  it('提取模式与 persona 注入开关持久化', () => {
    expect(store.getExtractionMode()).toBe('llm')
    store.setExtractionMode('rule')
    expect(store.getExtractionMode()).toBe('rule')
    store.setExtractionMode('off')
    expect(store.getExtractionMode()).toBe('off')

    expect(store.isPersonaInjectionEnabled()).toBe(true)
    store.setPersonaInjectionEnabled(false)
    expect(store.isPersonaInjectionEnabled()).toBe(false)
    store.setPersonaInjectionEnabled(true)
    expect(store.isPersonaInjectionEnabled()).toBe(true)
  })

  it('清空全部记忆（clearAllMemory）', () => {
    store.writeAtom({ content: '要被清空的记忆', type: 'fact', priority: 50, confirmed: true })
    store.addCorrection({ raw: '纠正', rule: '规则' })
    store.writePersona('# 用户画像\n\n## 用户\nTest')
    expect(store.getMemoryStats().atomCount).toBeGreaterThan(0)
    store.clearAllMemory()
    const stats = store.getMemoryStats()
    expect(stats.atomCount).toBe(0)
    expect(stats.pendingCorrections).toBe(0)
    expect(stats.personaExists).toBe(false)
  })
})

describe('memory/service 工作记忆', () => {
  it('workingMemory 从 todo_context 生成摘要', async () => {
    const service = await import('../memory/service')
    store.writeAtom({ content: '正在开发 proactive memory', type: 'todo_context', priority: 80 })
    store.writeAtom({ content: '用户叫 Conrad', type: 'fact', priority: 60 })
    const wm = service.workingMemory()
    expect(wm.items.length).toBeGreaterThan(0)
    expect(wm.items.some((i) => i.includes('proactive memory'))).toBe(true)
    expect(wm.items.some((i) => i.includes('Conrad'))).toBe(false) // fact 不应进入工作记忆
    expect(typeof wm.updatedAt).toBe('number')
  })

  it('workingMemory 无任务时返回空', async () => {
    const service = await import('../memory/service')
    // beforeEach 已清空目录；写一条 fact（非任务）
    store.writeAtom({ content: '一条事实', type: 'fact', priority: 50 })
    const wm = service.workingMemory()
    expect(wm.items).toEqual([])
  })
})
