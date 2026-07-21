import { describe, expect, test } from 'bun:test'
import { chunkDocument, DOCUMENT_CONTEXT_MAX_TOKENS, estimatePromptTokens, retrieveDocumentContext } from './document-context'

describe('文档上下文预算', () => {
  test('长文档按重叠片段切分并只检索相关内容', () => {
    const text = `${'普通内容 '.repeat(2000)}关键结论：财政政策有效。${'尾部 '.repeat(2000)}`
    expect(chunkDocument(text).length).toBeGreaterThan(1)
    expect(retrieveDocumentContext(text, '财政政策')).toContain('财政政策有效')
  })

  test('注入内容永远不超过六万 token 预算', () => {
    const selected = retrieveDocumentContext('研究资料 '.repeat(200000), '研究资料')
    expect(estimatePromptTokens([selected])).toBeLessThanOrEqual(DOCUMENT_CONTEXT_MAX_TOKENS)
  })
})
