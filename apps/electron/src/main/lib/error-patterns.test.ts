import { describe, expect, test } from 'bun:test'
import { isTransientNetworkError, isMalformedResponseError } from './error-patterns'

describe('isTransientNetworkError', () => {
  // 原有覆盖：确保扩展正则未回归
  test.each([
    'terminated',
    'socket hang up',
    'read ECONNRESET',
    'connect ETIMEDOUT 1.2.3.4:443',
    'write EPIPE',
    'getaddrinfo ENOTFOUND api.anthropic.com',
    'getaddrinfo EAI_AGAIN api.anthropic.com',
    'connect ECONNREFUSED 127.0.0.1:443',
    'TypeError: fetch failed',
    'network error',
    'stream closed prematurely',
    'premature close',
  ])('Given 已知瞬时网络错误 "%s" Then 判定为可重试', (msg) => {
    expect(isTransientNetworkError(msg)).toBe(true)
  })

  // #903 新增覆盖：这些断连此前会绕过自动重试、误入终止分支并清除 sdkSessionId
  test.each([
    'The operation was aborted',
    'This operation was aborted',
    'AbortError: The operation was aborted',
    'Connection error.',
    'connection closed',
    'Connection reset by peer',
    'other side closed',
    'request was aborted',
    'request timed out',
    'connect ECONNABORTED',
  ])('Given #903 断连错误 "%s" Then 也判定为可重试', (msg) => {
    expect(isTransientNetworkError(msg)).toBe(true)
  })

  test('Given stderr 含瞬时网络错误 Then 判定为可重试', () => {
    expect(isTransientNetworkError(undefined, 'undici: other side closed')).toBe(true)
  })

  test('Given 普通业务错误 Then 不判定为瞬时网络错误', () => {
    expect(isTransientNetworkError('invalid api key')).toBe(false)
    expect(isTransientNetworkError('400 Bad Request: model not found')).toBe(false)
    expect(isTransientNetworkError()).toBe(false)
  })
})

describe('isMalformedResponseError', () => {
  test('Given JSON 解析失败 Then 判定为响应体解析失败', () => {
    expect(isMalformedResponseError('API Error: JSON Parse error: Unable to parse JSON string')).toBe(true)
    expect(isMalformedResponseError('Unexpected end of JSON input')).toBe(true)
  })

  test('Given 普通错误 Then 不判定为响应体解析失败', () => {
    expect(isMalformedResponseError('socket hang up')).toBe(false)
  })
})
