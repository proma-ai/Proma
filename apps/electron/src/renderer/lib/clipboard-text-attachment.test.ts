import { describe, expect, test } from 'bun:test'
import { createClipboardPendingFile, createClipboardTextDraft } from './clipboard-text-attachment'

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
})
