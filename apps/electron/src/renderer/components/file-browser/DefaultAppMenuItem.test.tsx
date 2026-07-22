import { describe, expect, test } from 'bun:test'
import { getDefaultAppOpenLabel } from '@/lib/default-app-open-label'

describe('默认应用打开文案', () => {
  test('given 默认应用探测失败 when 生成打开文案 then 保留系统默认应用入口', () => {
    expect(getDefaultAppOpenLabel(null)).toBe('用系统默认应用打开')
  })

  test('given 默认应用探测成功 when 生成打开文案 then 显示已探测的应用名称', () => {
    expect(getDefaultAppOpenLabel({
      name: 'Preview',
      appPath: '/System/Applications/Preview.app',
      iconDataUrl: 'data:image/png;base64,icon',
    })).toBe('用 Preview 打开')
  })
})
