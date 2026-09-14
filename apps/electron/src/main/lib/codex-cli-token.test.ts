import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseCodexCliToken,
  readCodexCliToken,
  resolveCodexCliAuthPath,
} from './codex-cli-token'

const NOW = 1_000_000_000_000 // 固定基准时间，避免依赖真实时钟
const NOW_SEC = Math.floor(NOW / 1000)
const SKEW_MS = 5 * 60_000

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function makeJwt(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  return `${header}.${payload}.fakesig`
}

function authFile(raw: Record<string, unknown>): string {
  return JSON.stringify(raw)
}

const validAccess = (expSec = NOW_SEC + 10 * 24 * 3600) =>
  makeJwt({
    exp: expSec,
    'https://api.openai.com/auth': { chatgpt_account_id: 'jwt-acct-123' },
  })

describe('parseCodexCliToken', () => {
  it('文件缺失/非法 JSON/非对象 → null', () => {
    expect(parseCodexCliToken('', NOW)).toBeNull()
    expect(parseCodexCliToken('not json', NOW)).toBeNull()
    expect(parseCodexCliToken('[]', NOW)).toBeNull()
  })

  it('auth_mode 非 chatgpt（如 API key 模式）→ null', () => {
    const raw = authFile({ auth_mode: 'apikey', tokens: { access_token: validAccess() } })
    expect(parseCodexCliToken(raw, NOW)).toBeNull()
  })

  it('缺少 access_token → null', () => {
    expect(parseCodexCliToken(authFile({ auth_mode: 'chatgpt', tokens: {} }), NOW)).toBeNull()
  })

  it('access_token 不是合法 JWT → null', () => {
    const raw = authFile({ auth_mode: 'chatgpt', tokens: { access_token: 'opaque-token' } })
    expect(parseCodexCliToken(raw, NOW)).toBeNull()
  })

  it('JWT 缺少有效 exp → null', () => {
    const raw = authFile({
      auth_mode: 'chatgpt',
      tokens: { access_token: makeJwt({ 'https://api.openai.com/auth': {} }) },
    })
    expect(parseCodexCliToken(raw, NOW)).toBeNull()
  })

  it('已过期 → null', () => {
    const raw = authFile({
      auth_mode: 'chatgpt',
      tokens: { access_token: validAccess(NOW_SEC - 60) },
    })
    expect(parseCodexCliToken(raw, NOW)).toBeNull()
  })

  it('剩余有效期不足/恰好等于安全窗 → null（边界 <= now+skew）', () => {
    const withinWindow = authFile({
      auth_mode: 'chatgpt',
      tokens: { access_token: validAccess(NOW_SEC + 4 * 60) },
    })
    const atBoundary = authFile({
      auth_mode: 'chatgpt',
      tokens: { access_token: validAccess(NOW_SEC + 5 * 60) },
    })
    expect(parseCodexCliToken(withinWindow, NOW, SKEW_MS)).toBeNull()
    expect(parseCodexCliToken(atBoundary, NOW, SKEW_MS)).toBeNull()
  })

  it('有效令牌：refresh 必为空串、expires 来自 JWT、accountId 优先用文件字段', () => {
    const raw = authFile({
      auth_mode: 'chatgpt',
      tokens: { access_token: validAccess(), account_id: 'file-acct-999' },
    })
    const result = parseCodexCliToken(raw, NOW)
    expect(result).not.toBeNull()
    expect(result!.refresh).toBe('')
    expect(result!.access).toBe(validAccess())
    expect(result!.expires).toBe((NOW_SEC + 10 * 24 * 3600) * 1000)
    expect(result!.accountId).toBe('file-acct-999')
    expect(result && 'source' in result).toBe(false)
  })

  it('文件无 account_id 时从 JWT claim 兜底', () => {
    const raw = authFile({ auth_mode: 'chatgpt', tokens: { access_token: validAccess() } })
    expect(parseCodexCliToken(raw, NOW)!.accountId).toBe('jwt-acct-123')
  })

  it('刚超过安全窗 → 接受', () => {
    const raw = authFile({
      auth_mode: 'chatgpt',
      tokens: { access_token: validAccess(NOW_SEC + 6 * 60) },
    })
    expect(parseCodexCliToken(raw, NOW, SKEW_MS)).not.toBeNull()
  })
})

describe('readCodexCliToken / resolveCodexCliAuthPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proma-codex-token-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('文件不存在 → null（不抛错）', () => {
    expect(readCodexCliToken({ codexHome: join(dir, 'missing') })).toBeNull()
  })

  it('路径解析：入参 > CODEX_HOME > ~/.codex', () => {
    const prev = process.env.CODEX_HOME
    process.env.CODEX_HOME = '/env/codex'
    expect(resolveCodexCliAuthPath('/explicit')).toBe(join('/explicit', 'auth.json'))
    expect(resolveCodexCliAuthPath()).toBe(join('/env/codex', 'auth.json'))
    process.env.CODEX_HOME = ''
    expect(resolveCodexCliAuthPath()).toBe(join(require('node:os').homedir(), '.codex', 'auth.json'))
    if (prev === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = prev
  })

  it('有效文件 → 返回凭据；refresh_token 存在但不被借用', () => {
    // 该用例走真实 Date.now()，exp 必须基于真实时钟而非固定 NOW。
    const realAccess = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 10 * 24 * 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'jwt-acct-123' },
    })
    writeFileSync(
      join(dir, 'auth.json'),
      authFile({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: realAccess,
          refresh_token: 'must-not-be-used',
          account_id: 'file-acct-999',
        },
      }),
    )
    const result = readCodexCliToken({ codexHome: dir })
    expect(result).not.toBeNull()
    expect(result!.refresh).toBe('')
    expect(result!.accountId).toBe('file-acct-999')
  })
})
