import { describe, expect, test } from 'bun:test'
import {
  chunkDocument,
  DOCUMENT_CONTEXT_MAX_TOKENS,
  estimatePromptTokens,
  retrieveDocumentContexts,
} from './document-context'

describe('文档上下文预算', () => {
  test('长文档按保守 token 预算重叠切分并检索中文相关内容', () => {
    const text = `${'普通内容 '.repeat(4_000)}关键结论：财政政策有效。${'尾部 '.repeat(4_000)}`
    const chunks = chunkDocument(text)
    const result = retrieveDocumentContexts([{ filename: '财政报告.pdf', text }], '财政政策')

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.tokens <= 1_100)).toBeTrue()
    expect(result.content).toContain('财政政策有效')
  })

  test('多份文档共享六万 token 总预算', () => {
    const result = retrieveDocumentContexts([
      { filename: '甲.pdf', text: `甲文档 财政政策 ${'研究资料 '.repeat(20_000)}` },
      { filename: '乙.pdf', text: `乙文档 货币政策 ${'研究资料 '.repeat(20_000)}` },
    ], '比较财政政策与货币政策')

    expect(result.includedDocuments).toEqual(['甲.pdf', '乙.pdf'])
    expect(result.estimatedTokens).toBeLessThanOrEqual(DOCUMENT_CONTEXT_MAX_TOKENS)
  })

  test('相同文档只注入一次', () => {
    const text = `重复文档 ${'内容 '.repeat(2_000)}`
    const result = retrieveDocumentContexts([
      { filename: '原件.pdf', text },
      { filename: '副本.pdf', text },
    ], '重复文档')

    expect(result.duplicateDocumentsSkipped).toBe(1)
    expect(result.includedDocuments).toEqual(['原件.pdf'])
  })

  test('使用 Anthropic tokenizer 估算完整 prompt', () => {
    expect(estimatePromptTokens(['hello world', '财政政策'])).toBeGreaterThan(0)
  })

  test('百万字符文档分块保持线性性能且不调用全文 tokenizer', () => {
    const text = '财政政策与货币政策。'.repeat(100_000)
    const startedAt = performance.now()
    const chunks = chunkDocument(text)
    const elapsedMs = performance.now() - startedAt

    expect(chunks.length).toBeGreaterThan(1_000)
    expect(chunks.every((chunk) => chunk.tokens <= 1_100)).toBeTrue()
    expect(elapsedMs).toBeLessThan(5_000)
  })
})
