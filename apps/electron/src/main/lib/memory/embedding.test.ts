/**
 * Memory Embedding 单元测试（纯函数，不依赖 node-llama-cpp 加载）
 */

import { describe, expect, it } from 'bun:test'
import { cosineSimilarity, getEmbeddingMode, isLocalEmbeddingReady } from '../memory/embedding'

describe('memory/embedding 纯函数', () => {
  it('cosineSimilarity 相同向量为 1', () => {
    const v = [1, 2, 3]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1)
  })

  it('cosineSimilarity 正交向量为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('cosineSimilarity 维度不一致返回 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('cosineSimilarity 空数组返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('getEmbeddingMode 默认 off，env 覆盖生效', () => {
    const before = process.env.PROMA_MEMORY_EMBEDDING
    delete process.env.PROMA_MEMORY_EMBEDDING
    expect(getEmbeddingMode()).toBe('off')
    process.env.PROMA_MEMORY_EMBEDDING = 'local'
    expect(getEmbeddingMode()).toBe('local')
    process.env.PROMA_MEMORY_EMBEDDING = 'api'
    expect(getEmbeddingMode()).toBe('api')
    if (before === undefined) delete process.env.PROMA_MEMORY_EMBEDDING
    else process.env.PROMA_MEMORY_EMBEDDING = before
  })

  it('isLocalEmbeddingReady 函数存在（模型路径可检查）', () => {
    expect(typeof isLocalEmbeddingReady).toBe('function')
  })
})
