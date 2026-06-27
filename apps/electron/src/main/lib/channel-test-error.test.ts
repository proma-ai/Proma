import { describe, expect, test } from 'bun:test'
import {
  classifyHttpStatus,
  extractErrorMessage,
  summarizeDetail,
  normalizeHttpResponse,
  normalizeRequestError,
} from './channel-test-error'

describe('classifyHttpStatus - 状态码主轴', () => {
  test.each([
    [401, 'auth'],
    [402, 'quota'],
    [404, 'not_found'],
    [408, 'timeout'],
    [405, 'bad_request'],
    [409, 'bad_request'],
    [413, 'bad_request'],
    [415, 'bad_request'],
    [422, 'bad_request'],
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
    [418, 'unknown'],
  ] as const)('Given %i（无歧义文本）Then 归类为 %s', (status, expected) => {
    expect(classifyHttpStatus(status, '')).toBe(expected)
  })

  test('Given 5xx 即便响应体含 quota 字样 Then 仍归类为 server', () => {
    expect(classifyHttpStatus(503, 'insufficient_quota')).toBe('server')
  })
})

describe('classifyHttpStatus - 歧义状态借文本消解', () => {
  // 403：默认 permission；含 auth 特征 → auth（Google 风格）
  test('Given 403 普通禁止 Then permission', () => {
    expect(classifyHttpStatus(403, 'forbidden')).toBe('permission')
  })
  test('Given 403 且文本为 API key not valid Then auth', () => {
    expect(classifyHttpStatus(403, 'API key not valid. Please pass a valid API key.')).toBe('auth')
  })

  // 400：默认 bad_request；含 auth 特征 → auth（Google 用 400 表达 Key 无效）
  test('Given 400 普通参数错误 Then bad_request', () => {
    expect(classifyHttpStatus(400, 'invalid request: missing field')).toBe('bad_request')
  })
  test('Given 400 且文本为 API_KEY_INVALID Then auth', () => {
    expect(classifyHttpStatus(400, '{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid"}}')).toBe('auth')
  })

  // 429：默认 rate_limit；含 quota 特征 → quota（OpenAI 的 insufficient_quota）
  test('Given 429 普通限流 Then rate_limit', () => {
    expect(classifyHttpStatus(429, 'Rate limit reached for requests')).toBe('rate_limit')
  })
  test('Given 429 且文本为 insufficient_quota Then quota', () => {
    expect(classifyHttpStatus(429, 'You exceeded your current quota, insufficient_quota')).toBe('quota')
  })
})

describe('extractErrorMessage - 兼容多家结构', () => {
  test('OpenAI / Anthropic 嵌套 error.message', () => {
    expect(extractErrorMessage('{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}'))
      .toBe('Incorrect API key provided')
  })
  test('顶层 message', () => {
    expect(extractErrorMessage('{"message":"boom"}')).toBe('boom')
  })
  test('无 message 时回退到 code/type/status', () => {
    expect(extractErrorMessage('{"error":{"code":"model_not_found"}}')).toBe('model_not_found')
  })
  test('纯文本 / HTML 原样返回', () => {
    expect(extractErrorMessage('<html>404 Not Found</html>')).toBe('<html>404 Not Found</html>')
  })
  test('空体返回空串', () => {
    expect(extractErrorMessage('   ')).toBe('')
  })
})

describe('summarizeDetail - 脱敏与截断', () => {
  test('脱敏 Bearer Token', () => {
    expect(summarizeDetail('header Authorization: Bearer sk-ant-abc123def456'))
      .not.toContain('sk-ant-abc123def456')
  })
  test('脱敏 sk- 开头的 Key', () => {
    const out = summarizeDetail('key leaked: sk-proj-ABCDEFGH12345678') ?? ''
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('ABCDEFGH12345678')
  })
  test('脱敏 URL 查询参数中的 key=（Google 风格）', () => {
    const out = summarizeDetail('failed to fetch https://x/v1beta/models?key=AIzaSyVERYSECRET') ?? ''
    expect(out).not.toContain('AIzaSyVERYSECRET')
  })
  test('脱敏 json 字段 api_key', () => {
    const out = summarizeDetail('{"api_key":"super-secret-value"}') ?? ''
    expect(out).not.toContain('super-secret-value')
  })
  test('压缩空白', () => {
    expect(summarizeDetail('a   \n  b')).toBe('a b')
  })
  test('超长截断到 500 字符并加省略号', () => {
    const out = summarizeDetail('x'.repeat(1000)) ?? ''
    expect(out.length).toBe(501) // 500 + 省略号
    expect(out.endsWith('…')).toBe(true)
  })
  test('空内容返回 undefined', () => {
    expect(summarizeDetail('   ')).toBeUndefined()
  })
})

describe('normalizeHttpResponse - 端到端（仅 2xx 成功）', () => {
  test('200 → 成功', async () => {
    const result = await normalizeHttpResponse(new Response('{}', { status: 200 }))
    expect(result.success).toBe(true)
    expect(result.message).toBe('连接成功')
  })

  // 核心回归：#770 —— 403/404/429/5xx 不再被误判为成功
  test.each([403, 404, 429, 500, 503] as const)('%i → 失败（修复 #770）', async (status) => {
    const result = await normalizeHttpResponse(new Response('err', { status }))
    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(status)
  })

  test('401 → auth，且携带脱敏后的供应商摘要', async () => {
    const body = JSON.stringify({ error: { message: 'Incorrect API key provided: sk-abcdEFGH1234' } })
    const result = await normalizeHttpResponse(new Response(body, { status: 401 }))
    expect(result.success).toBe(false)
    expect(result.errorType).toBe('auth')
    expect(result.statusCode).toBe(401)
    expect(result.detail).toBeDefined()
    expect(result.message).not.toContain('sk-abcdEFGH1234')
  })

  test('Google 400 API key not valid → auth（不再误报 bad_request）', async () => {
    const body = JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid' } })
    const result = await normalizeHttpResponse(new Response(body, { status: 400 }))
    expect(result.errorType).toBe('auth')
  })

  test('OpenAI 429 insufficient_quota → quota（不再误报 rate_limit）', async () => {
    const body = JSON.stringify({ error: { message: 'You exceeded your current quota', type: 'insufficient_quota' } })
    const result = await normalizeHttpResponse(new Response(body, { status: 429 }))
    expect(result.errorType).toBe('quota')
  })

  test('无响应体时回退到 statusText', async () => {
    const result = await normalizeHttpResponse(new Response(null, { status: 404, statusText: 'Not Found' }))
    expect(result.errorType).toBe('not_found')
    expect(result.success).toBe(false)
  })
})

describe('normalizeRequestError - 异常分类', () => {
  test('AbortSignal.timeout 触发的 TimeoutError → timeout', () => {
    const err = new DOMException('The operation timed out', 'TimeoutError')
    expect(normalizeRequestError(err).errorType).toBe('timeout')
  })
  test('AbortError → timeout', () => {
    const err = new DOMException('The operation was aborted', 'AbortError')
    expect(normalizeRequestError(err).errorType).toBe('timeout')
  })
  test('非法 URL → bad_request（不再误报 network）', () => {
    expect(normalizeRequestError(new TypeError('Failed to parse URL from xxx')).errorType).toBe('bad_request')
  })
  test('fetch failed → network', () => {
    expect(normalizeRequestError(new TypeError('fetch failed')).errorType).toBe('network')
  })
  test('携带 cause 的网络错误 → network', () => {
    const err = new TypeError('fetch failed')
    ;(err as { cause?: unknown }).cause = new Error('getaddrinfo ENOTFOUND api.example.com')
    expect(normalizeRequestError(err).errorType).toBe('network')
  })
  test('异常摘要也会脱敏', () => {
    const err = new Error('connect failed for https://x?key=AIzaSECRETLEAK')
    const result = normalizeRequestError(err)
    expect(result.message).not.toContain('AIzaSECRETLEAK')
  })
})
