import { describe, expect, test } from 'bun:test'
import { removePromaAutoCompactSettings } from './agent-auto-compact-settings'

describe('Agent 自动压缩设置清理', () => {
  test('Given settings 含自动压缩窗口和开关 When 清理 Proma 自动压缩设置 Then 删除两个字段', () => {
    const settings: Record<string, unknown> = {
      plansDirectory: '.context',
      autoCompactEnabled: true,
      autoCompactWindow: 850_000,
    }

    const changed = removePromaAutoCompactSettings(settings)

    expect(changed).toBe(true)
    expect(settings).toEqual({ plansDirectory: '.context' })
  })

  test('Given settings 只含自动压缩开关 When 清理 Proma 自动压缩设置 Then 删除开关字段', () => {
    const settings: Record<string, unknown> = {
      autoCompactEnabled: false,
      skipWebFetchPreflight: true,
    }

    const changed = removePromaAutoCompactSettings(settings)

    expect(changed).toBe(true)
    expect(settings).toEqual({ skipWebFetchPreflight: true })
  })

  test('Given settings 没有自动压缩字段 When 清理 Proma 自动压缩设置 Then 不改动', () => {
    const settings: Record<string, unknown> = {
      plansDirectory: '.context',
      skipWebFetchPreflight: true,
    }

    const changed = removePromaAutoCompactSettings(settings)

    expect(changed).toBe(false)
    expect(settings).toEqual({
      plansDirectory: '.context',
      skipWebFetchPreflight: true,
    })
  })
})
