import { describe, expect, test } from 'bun:test'
import {
  serializeCodexCredentials,
  parseCodexCredentials,
  isCodexCredentialExpired,
  type CodexOAuthCredentials,
} from './channel'

const sample: CodexOAuthCredentials = {
  access: 'access-token',
  refresh: 'refresh-token',
  expires: 1_800_000_000_000,
  accountId: 'acct_123',
}

describe('Codex OAuth 凭据序列化', () => {
  test('Given 凭据 When 序列化再解析 Then 往返一致', () => {
    const round = parseCodexCredentials(serializeCodexCredentials(sample))
    expect(round).toEqual(sample)
  })

  test('Given 无 accountId 的凭据 When 往返 Then 省略可选字段', () => {
    const minimal: CodexOAuthCredentials = { access: 'a', refresh: 'r', expires: 123 }
    expect(parseCodexCredentials(serializeCodexCredentials(minimal))).toEqual(minimal)
  })
})

describe('Codex OAuth 凭据解析', () => {
  test('Given 空字符串 When 解析 Then null', () => {
    expect(parseCodexCredentials('')).toBeNull()
    expect(parseCodexCredentials('   ')).toBeNull()
  })

  test('Given 非 JSON When 解析 Then null（不抛错）', () => {
    expect(parseCodexCredentials('sk-plain-api-key')).toBeNull()
  })

  test('Given 缺少必需字段 When 解析 Then null', () => {
    expect(parseCodexCredentials('{"access":"a"}')).toBeNull()
    expect(parseCodexCredentials('{"access":"a","refresh":"r"}')).toBeNull()
    expect(parseCodexCredentials('{"refresh":"r","expires":1}')).toBeNull()
  })

  test('Given expires 非数字 When 解析 Then null', () => {
    expect(parseCodexCredentials('{"access":"a","refresh":"r","expires":"soon"}')).toBeNull()
  })
})

describe('Codex OAuth 凭据过期判定', () => {
  test('Given 远期 expires When 判定 Then 未过期', () => {
    expect(isCodexCredentialExpired({ ...sample, expires: Date.now() + 3_600_000 })).toBe(false)
  })

  test('Given 已过期 expires When 判定 Then 过期', () => {
    expect(isCodexCredentialExpired({ ...sample, expires: Date.now() - 1000 })).toBe(true)
  })

  test('Given 即将过期（在 skew 余量内）When 判定 Then 过期', () => {
    // 默认 60s 余量：expires 在 30s 后应被判为需刷新，避免边界请求打出去才发现过期。
    expect(isCodexCredentialExpired({ ...sample, expires: Date.now() + 30_000 })).toBe(true)
  })

  test('Given 自定义 skew=0 When 恰好未到期 Then 未过期', () => {
    expect(isCodexCredentialExpired({ ...sample, expires: Date.now() + 5_000 }, 0)).toBe(false)
  })
})
