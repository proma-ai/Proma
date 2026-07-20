import { describe, expect, test } from 'bun:test'
import { redactSensitiveLogText, redactSensitiveLogValue } from './bridge-log-redaction'

describe('Bridge 日志脱敏', () => {
  test('Given 键值、Authorization header 和 query token When 输出文本日志 Then 保留诊断字段并脱敏秘密', () => {
    const log = redactSensitiveLogText(
      'clientId=ding-client clientSecret=ding-secret authorization: Bearer bearer-token https://example.test?access_token=url-token',
    )

    expect(log).toContain('clientId=ding-client')
    expect(log).toContain('clientSecret=[REDACTED]')
    expect(log).toContain('authorization: [REDACTED]')
    expect(log).toContain('access_token=[REDACTED]')
    expect(log).not.toContain('ding-secret')
    expect(log).not.toContain('bearer-token')
    expect(log).not.toContain('url-token')
  })

  test('Given 含凭证的 SDK 错误和回调载荷 When 输出日志 Then 递归脱敏并保留非敏感字段', () => {
    const error = new Error('request failed: apiKey=api-key-value')
    const redacted = redactSensitiveLogValue({
      clientId: 'ding-client',
      clientSecret: 'ding-secret',
      accessToken: 'access-token',
      authorization: 'Bearer bearer-token',
      nested: { sessionWebhook: 'https://example.test/webhook?token=webhook-token' },
      error,
    }) as Record<string, unknown>

    expect(redacted).toMatchObject({
      clientId: 'ding-client',
      clientSecret: '[REDACTED]',
      accessToken: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: { sessionWebhook: '[REDACTED]' },
    })
    expect(JSON.stringify(redacted)).not.toContain('ding-secret')
    expect(JSON.stringify(redacted)).not.toContain('access-token')
    expect(JSON.stringify(redacted)).not.toContain('webhook-token')
    expect(JSON.stringify(redacted)).not.toContain('api-key-value')
  })
})
