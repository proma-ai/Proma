import { describe, expect, test } from 'bun:test'
import { isTerminalProfile, parseTerminalProfile } from './terminal'

describe('终端 profile 解析', () => {
  test('Given 省略或空串 When 解析 Then 回退到 default', () => {
    expect(parseTerminalProfile(undefined)).toBe('default')
    expect(parseTerminalProfile(null)).toBe('default')
    expect(parseTerminalProfile('')).toBe('default')
  })

  test('Given 每个合法 profile When 解析 Then 原样返回', () => {
    const profiles = ['default', 'zsh', 'bash', 'pwsh', 'powershell', 'cmd', 'git-bash', 'wsl'] as const
    for (const profile of profiles) {
      expect(parseTerminalProfile(profile)).toBe(profile)
      expect(isTerminalProfile(profile)).toBe(true)
    }
  })

  test('Given 未知值 When 解析 Then 显式抛错而非静默回退', () => {
    expect(() => parseTerminalProfile('pwsh7')).toThrow()
    expect(() => parseTerminalProfile('PowerShell')).toThrow()
    expect(() => parseTerminalProfile(123)).toThrow()
    expect(() => parseTerminalProfile({})).toThrow()
  })

  test('Given 非法值 When 解析 Then 错误信息列出全部可选值', () => {
    try {
      parseTerminalProfile('fish')
      expect.unreachable()
    } catch (error) {
      expect(String(error)).toContain('git-bash')
      expect(String(error)).toContain('wsl')
    }
  })
})
