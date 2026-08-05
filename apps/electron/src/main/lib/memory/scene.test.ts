/**
 * Memory Scene 单元测试 — L2 场景聚类与热度
 */

import { describe, expect, test } from 'bun:test'
import type { MemoryAtom } from '@proma/shared'
import { atomTopicTerms, clusterAtomsToScenes, sceneHeat, SCENE_MERGE_MIN_SHARED } from '../memory/scene'

function makeAtom(partial: Partial<MemoryAtom> & { content: string; type?: MemoryAtom['type'] }): MemoryAtom {
  const now = Date.now()
  return {
    id: `atom_${Math.random().toString(36).slice(2, 8)}`,
    content: partial.content,
    type: partial.type ?? 'fact',
    priority: partial.priority ?? 50,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? (partial.createdAt ?? now),
    confirmed: partial.confirmed ?? true,
    ...(partial.fingerprint ? { fingerprint: partial.fingerprint } : {}),
  }
}

function toMap(atoms: MemoryAtom[]): Map<string, MemoryAtom> {
  return new Map(atoms.map((a) => [a.id, a]))
}

describe('memory/scene: 主题词提取', () => {
  test('提取中文 bigram 与英文单词，过滤单字', () => {
    const atom = makeAtom({ content: 'CodeLens 项目用 TypeScript 开发' })
    const terms = atomTopicTerms(atom)
    // bigram（codelens? 英文词：codelens/typescript）与中文 bigram 都有
    expect(terms.some((t) => t.includes('code') || t === 'codelens')).toBe(true)
    expect(terms.includes('typescript')).toBe(true)
    expect(terms.includes('项目')).toBe(true)
    expect(terms.includes('开发')).toBe(true)
    // 单字不参与（“用”“发”等被过滤）
    expect(terms.some((t) => t.length === 1 && /[\u4e00-\u9fff]/.test(t))).toBe(false)
  })
})

describe('memory/scene: 主题聚类', () => {
  test('同主题 atoms 归并到一个场景', () => {
    const atoms = [
      makeAtom({ content: 'CodeLens 项目用 TypeScript 开发 AST 分析器' }),
      makeAtom({ content: 'CodeLens 的 AST 分析器性能优化' }),
      makeAtom({ content: '今天天气很好' }),
    ]
    const clusters = clusterAtomsToScenes(atoms)
    // 前两条同主题（CodeLens/AST）应合并；天气独立
    const codeLens = clusters.find((c) => c.atomIds.length >= 2)
    expect(codeLens).toBeDefined()
    expect(clusters.length).toBeGreaterThanOrEqual(2)
  })

  test('不同主题不合并', () => {
    const atoms = [
      makeAtom({ content: 'CodeLens 项目开发' }),
      makeAtom({ content: 'ShopGo 订单拆分' }),
    ]
    const clusters = clusterAtomsToScenes(atoms)
    expect(clusters.length).toBe(2)
  })

  test('minShared 可调：阈值提高后更少合并', () => {
    const atoms = [
      makeAtom({ content: 'CodeLens 项目用 TypeScript' }),
      makeAtom({ content: 'CodeLens 的性能瓶颈' }),
    ]
    const loose = clusterAtomsToScenes(atoms, { minShared: 1 })
    const strict = clusterAtomsToScenes(atoms, { minShared: 3 })
    expect(loose.length).toBe(1)
    expect(strict.length).toBe(2)
  })
})

describe('memory/scene: 热度', () => {
  test('correction/sop 稳定不衰减 → 热度不低于新鲜事实', () => {
    const now = Date.now()
    const oldCorrection = makeAtom({ content: '以后报告进度先给结论', type: 'correction', createdAt: now - 60 * 86_400_000 })
    const freshFact = makeAtom({ content: 'CodeLens 今天发版', createdAt: now - 1 * 86_400_000 })
    const cluster1 = clusterAtomsToScenes([oldCorrection])[0]!
    const cluster2 = clusterAtomsToScenes([freshFact])[0]!
    const h1 = sceneHeat(cluster1, toMap([oldCorrection]), now)
    const h2 = sceneHeat(cluster2, toMap([freshFact]), now)
    // correction 60 天不衰减 = 1.0；fresh fact 衰减很小 ≈ 0.977
    expect(h1).toBeGreaterThanOrEqual(h2)
  })

  test('同场景 atom 越多热度越高', () => {
    const atoms = [
      makeAtom({ content: 'CodeLens 项目用 TypeScript 开发 AST 分析器' }),
      makeAtom({ content: 'CodeLens 项目的 AST 分析器做性能优化' }),
      makeAtom({ content: 'CodeLens 项目的 AST 分析器写单元测试' }),
    ]
    // 三条内容共享多个主题词（codelens/项目/ast/分析器），应合并为一个场景
    const single = clusterAtomsToScenes([atoms[0]!])[0]!
    const multi = clusterAtomsToScenes(atoms)[0]!
    expect(multi.atomIds.length).toBe(3)
    const h1 = sceneHeat(single, toMap([atoms[0]!]))
    const hMulti = sceneHeat(multi, toMap(atoms))
    expect(hMulti).toBeGreaterThan(h1)
  })

  test('空场景热度为 0', () => {
    expect(sceneHeat({ title: 'x', atomIds: [], terms: [] }, new Map())).toBe(0)
  })
})

// 保持 SCENE_MERGE_MIN_SHARED 常量可被测试引用（防止误改阈值破坏语义）
describe('memory/scene: 常量', () => {
  test('默认合并阈值为 2', () => {
    expect(SCENE_MERGE_MIN_SHARED).toBe(2)
  })
})
