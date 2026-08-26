import { describe, expect, test } from 'bun:test'
import { createClipboardPendingFile, createClipboardTextDraft, shouldConvertClipboardTextToAttachment } from './clipboard-text-attachment'
import { hasRichClipboardMarkup, looksLikeMarkdownText } from './markdown-rich-text'

describe('长文本粘贴附件', () => {
  test('Given Markdown 长文本 When 转为草稿文件 Then 使用可编辑的 Markdown 文件元数据', () => {
    const draft = createClipboardTextDraft('# 标题\n\n内容', [], new Date('2026-05-28T12:34:56'))

    expect(draft).toEqual({
      filename: 'clipboard-20260528-123456.md',
      mediaType: 'text/markdown',
      size: 16,
    })
  })

  test('Given 同一秒内已有同名草稿 When 再次转为草稿文件 Then 文件名追加序号避免覆盖', () => {
    const draft = createClipboardTextDraft(
      '普通长文本',
      ['clipboard-20260528-123456.txt'],
      new Date('2026-05-28T12:34:56'),
    )

    expect(draft.filename).toBe('clipboard-20260528-123456-1.txt')
  })

  test('Given 草稿文件已经落盘 When 创建待发送附件 Then sourcePath 成为发送时的真实数据源', () => {
    const draft = createClipboardTextDraft('普通长文本', [], new Date('2026-05-28T12:34:56'))
    const pending = createClipboardPendingFile(draft, '/tmp/proma-preview/clipboard-20260528-123456.txt', 'pending-1')

    expect(pending).toMatchObject({
      id: 'pending-1',
      filename: 'clipboard-20260528-123456.txt',
      mediaType: 'text/plain',
      sourcePath: '/tmp/proma-preview/clipboard-20260528-123456.txt',
      isClipboardDraft: true,
    })
  })

  test('Given 超过阈值的 Markdown 粘贴 When 附件转换开启 Then 优先转为 Markdown 附件', () => {
    const markdown = `# 标题\n\n${'这是一段较长的内容。'.repeat(4)}`

    expect(looksLikeMarkdownText(markdown)).toBe(true)
    expect(shouldConvertClipboardTextToAttachment({
      enabled: true,
      plainText: markdown,
      normalizedText: markdown,
      threshold: 32,
    })).toBe(true)
  })

  test('Given 未超过阈值的纯 Markdown When 附件转换开启 Then 保留富文本解析路径', () => {
    const markdown = '# 标题\n\n**短文本**'

    expect(looksLikeMarkdownText(markdown)).toBe(true)
    expect(hasRichClipboardMarkup('')).toBe(false)
    expect(shouldConvertClipboardTextToAttachment({
      enabled: true,
      plainText: markdown,
      normalizedText: markdown,
      threshold: 100,
    })).toBe(false)
  })

  test('Given 普通文本或已带语义 HTML 的内容 When 粘贴 Then 不进入 Markdown 解析路径', () => {
    const plainText = '这是一段没有 Markdown 标记的普通文本。'
    const semanticMarkdown = '**粗体**'

    expect(looksLikeMarkdownText(plainText)).toBe(false)
    expect(looksLikeMarkdownText(semanticMarkdown)).toBe(true)
    expect(hasRichClipboardMarkup('<p><strong>粗体</strong></p>')).toBe(true)
  })
})
