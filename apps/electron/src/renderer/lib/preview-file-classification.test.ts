import { describe, expect, test } from 'bun:test'
import {
  MAX_AUTO_EDIT_CHARS,
  classifyPreviewFile,
  isEditablePreviewText,
  shouldAutoEnterTextEdit,
} from './preview-file-classification'

describe('预览文件分类', () => {
  test('将常见代码、配置和无后缀文本文件标记为可编辑', () => {
    for (const filePath of ['src/main.ts', 'config/app.yaml', 'Dockerfile', '.gitignore', 'scripts/deploy.ps1']) {
      expect(isEditablePreviewText(classifyPreviewFile(filePath).kind)).toBe(true)
    }
  })

  test('专用预览优先于文本分类，SVG 保持图片预览', () => {
    expect(classifyPreviewFile('assets/logo.svg').kind).toBe('image')
    expect(isEditablePreviewText(classifyPreviewFile('assets/logo.svg').kind)).toBe(false)
    expect(classifyPreviewFile('report.pdf').kind).toBe('pdf')
    expect(classifyPreviewFile('slides.pptx').kind).toBe('office')
  })
})

describe('自动进入编辑保护', () => {
  test('仅在可编辑、非只读且内容未超限时自动进入', () => {
    expect(shouldAutoEnterTextEdit({ enabled: true, readOnly: false, editable: true, contentLength: 128 })).toBe(true)
    expect(shouldAutoEnterTextEdit({ enabled: true, readOnly: true, editable: true, contentLength: 128 })).toBe(false)
    expect(shouldAutoEnterTextEdit({ enabled: true, readOnly: false, editable: false, contentLength: 128 })).toBe(false)
    expect(shouldAutoEnterTextEdit({ enabled: true, readOnly: false, editable: true, contentLength: MAX_AUTO_EDIT_CHARS + 1 })).toBe(false)
  })
})
