import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { serializeCodexCredentials } from '@proma/shared'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
  shell: {
    openExternal: async () => undefined,
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeChannels(channels: unknown[]): void {
  const configDir = join(tempHome, '.proma')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'channels.json'),
    JSON.stringify({ version: 2, channels }),
    'utf-8',
  )
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-channel-runtime-key-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  // codex 令牌解析须走临时 homedir，屏蔽调用环境可能存在的 CODEX_HOME。
  delete process.env.CODEX_HOME
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
  rmSync(join(tempHome, '.codex'), { recursive: true, force: true })
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('渠道运行时认证解析', () => {
  test('Given ChatGPT OAuth 渠道 When 解析运行时 key Then 返回 access token 而不是凭据 JSON', async () => {
    writeChannels([
      {
        id: 'codex-channel',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: serializeCodexCredentials({
          access: 'oauth-access-token',
          refresh: 'oauth-refresh-token',
          expires: Date.now() + 3_600_000,
        }),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('codex-channel'))
      .resolves.toBe('oauth-access-token')
  })

  test('Given 普通渠道 When 解析运行时 key Then 返回解密后的 API Key', async () => {
    writeChannels([
      {
        id: 'api-key-channel',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'plain-api-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('api-key-channel'))
      .resolves.toBe('plain-api-key')
  })
})

// ===== codex-cli 显式来源（credentialSource='codex-cli'）边界 =====
// 复用本文件已注册的 electron / node:os mock：homedir 指向 tempHome，
// 因此 ~/.codex 与 ~/.proma 都落在同一临时目录，无需再 mock ./codex-cli-token。

const codexAuthFile = () => join(tempHome, '.codex', 'auth.json')

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function writeCodexAuth(): void {
  mkdirSync(join(tempHome, '.codex'), { recursive: true })
  const token = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    exp: Math.floor(Date.now() / 1000) + 10 * 86_400,
  })}.sig`
  writeFileSync(codexAuthFile(), JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: token, refresh_token: 'opaque', account_id: 'acct_1234567890' },
  }), 'utf-8')
}

const cliChannel = () => ({
  id: 'cli-channel',
  name: 'ChatGPT',
  provider: 'openai-codex',
  baseUrl: '',
  apiKey: '',
  models: [],
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  credentialSource: 'codex-cli',
})

describe('codex-cli 显式来源', () => {
  test('Given codex-cli 渠道 When 解析 Then 实时返回本机令牌且 refresh 为空', async () => {
    writeCodexAuth()
    writeChannels([cliChannel()])
    const resolved = await channelManager.resolveCodexOAuthCredentials('cli-channel')
    expect(resolved.refresh).toBe('')
    expect(resolved.access.split('.')).toHaveLength(3)
    expect(resolved.accountId).toBe('acct_1234567890')
  })

  test('Given codex-cli 渠道但本机无登录 When 解析 Then 引导 codex login 而非串用', async () => {
    rmSync(codexAuthFile(), { force: true })
    writeChannels([cliChannel()])
    await expect(channelManager.resolveCodexOAuthCredentials('cli-channel'))
      .rejects.toThrow(/codex login/)
  })

  test('Given 无来源标记的空凭据渠道 When 本机令牌恰好有效 Then 也绝不旁路（防账号串用）', async () => {
    writeCodexAuth()
    writeChannels([{ ...cliChannel(), id: 'normal-channel', credentialSource: undefined }])
    await expect(channelManager.resolveCodexOAuthCredentials('normal-channel'))
      .rejects.toThrow(/请重新登录/)
  })

  test('Given codex-cli 渠道 When SDK 回写刷新凭据 Then 被忽略且 apiKey 保持空', () => {
    writeCodexAuth()
    writeChannels([cliChannel()])
    channelManager.persistCodexOAuthCredentials('cli-channel', {
      access: 'rotated', refresh: 'rotated-refresh', expires: Date.now() + 999,
    })
    expect(channelManager.getChannelById('cli-channel')?.apiKey).toBe('')
  })

  test('getCodexCliStatus 只暴露可用性/账号/到期，绝不包含 token', () => {
    writeCodexAuth()
    const status = channelManager.getCodexCliStatus()
    expect(status.available).toBe(true)
    expect(status.accountId).toBe('acct_1234567890')
    expect(typeof status.expiresAt).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(status, 'access')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(status, 'refresh')).toBe(false)
  })

  test('getCodexCliStatus 在无登录时返回 available:false', () => {
    rmSync(codexAuthFile(), { force: true })
    expect(channelManager.getCodexCliStatus()).toEqual({ available: false })
  })

  test('createChannel 透传 credentialSource 且不存凭据', () => {
    const created = channelManager.createChannel({
      name: 'ChatGPT', provider: 'openai-codex', baseUrl: '',
      apiKey: '', models: [], enabled: true, credentialSource: 'codex-cli',
    })
    expect(created.credentialSource).toBe('codex-cli')
    expect(created.apiKey).toBe('')
  })

  test('updateChannel 写入真实 OAuth 凭据时自动清除来源标记', () => {
    writeCodexAuth()
    writeChannels([cliChannel()])
    const real = serializeCodexCredentials({ access: 'a', refresh: 'r', expires: Date.now() + 999 })
    const updated = channelManager.updateChannel('cli-channel', { apiKey: real })
    expect(updated.credentialSource).toBeUndefined()
    expect(updated.apiKey).not.toBe('')
  })

  test('updateChannel 切到 codex-cli 来源时清空已存凭据并标记', () => {
    const real = serializeCodexCredentials({ access: 'a', refresh: 'r', expires: Date.now() + 999 })
    writeChannels([{ ...cliChannel(), id: 'c', apiKey: real, credentialSource: undefined }])
    const updated = channelManager.updateChannel('c', { credentialSource: 'codex-cli' })
    expect(updated.credentialSource).toBe('codex-cli')
    expect(updated.apiKey).toBe('')
  })

  test('createChannel 对 codex-cli 幂等：已存在则返回既有渠道且不新增', () => {
    writeChannels([cliChannel()])
    const before = channelManager.listChannels().length
    const result = channelManager.createChannel({
      name: '另一个 ChatGPT', provider: 'openai-codex', baseUrl: '',
      apiKey: '', models: [], enabled: true, credentialSource: 'codex-cli',
    })
    expect(result.id).toBe('cli-channel')
    expect(channelManager.listChannels()).toHaveLength(before)
  })

  test('createChannel 对 codex-cli 幂等：与常规 OAuth 渠道可共存，不被误判为重复', () => {
    const real = serializeCodexCredentials({ access: 'a', refresh: 'r', expires: Date.now() + 999 })
    writeChannels([{ ...cliChannel(), id: 'oauth-channel', apiKey: real, credentialSource: undefined }])
    const input = {
      name: 'ChatGPT', provider: 'openai-codex' as const, baseUrl: '',
      apiKey: '', models: [], enabled: true, credentialSource: 'codex-cli' as const,
    }
    // 存量只有常规 OAuth 渠道时不应判重：允许新建一个 codex-cli 渠道。
    const first = channelManager.createChannel(input)
    expect(first.id).not.toBe('oauth-channel')
    const cliCount = () => channelManager.listChannels()
      .filter((c) => c.provider === 'openai-codex' && c.credentialSource === 'codex-cli').length
    expect(cliCount()).toBe(1)
    // 再来一次必须幂等：codex-cli 渠道仍恰好一个。
    const second = channelManager.createChannel(input)
    expect(second.id).toBe(first.id)
    expect(cliCount()).toBe(1)
  })

  test('getCodexCliStatus 依据存量 codex-cli 渠道返回 alreadyConfigured', () => {
    writeCodexAuth()
    expect(channelManager.getCodexCliStatus().alreadyConfigured).toBe(false)
    writeChannels([cliChannel()])
    expect(channelManager.getCodexCliStatus().alreadyConfigured).toBe(true)
  })

  test('Given codex-cli 渠道 When 查询订阅额度 Then 请求实时 CLI 令牌而非在空 apiKey 处提前失败', async () => {
    // 自造与文件中一致的 access token，写文件与请求头断言共用同一份值。
    const token = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      exp: Math.floor(Date.now() / 1000) + 10 * 86_400,
    })}.sig`
    mkdirSync(join(tempHome, '.codex'), { recursive: true })
    writeFileSync(codexAuthFile(), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: token, refresh_token: 'opaque', account_id: 'acct_1234567890' },
    }), 'utf-8')
    writeChannels([cliChannel()])

    const captured: { url?: string; auth?: string; account?: string } = {}
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input)
      const headers = new Headers(init?.headers)
      captured.auth = headers.get('Authorization') ?? undefined
      captured.account = headers.get('ChatGPT-Account-Id') ?? undefined
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch

    try {
      const result = await channelManager.getChannelPlanQuota('cli-channel')
      // 关键：确实发起了 wham/usage 请求（旧实现会在空 apiKey gate 处提前返回，fetch 不被调用）。
      expect(captured.url).toContain('wham/usage')
      expect(captured.auth).toBe(`Bearer ${token}`)
      expect(captured.account).toBe('acct_1234567890')
      // 不是「凭据缺失请重新登录」这类因空 apiKey 导致的早退错误。
      expect(result.message ?? '').not.toContain('凭据')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('Given codex-cli 渠道 When 编辑改成其它 provider Then credentialSource 被清空', () => {
    writeChannels([{ ...cliChannel(), id: 'switchable' }])
    const updated = channelManager.updateChannel('switchable', {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
    })
    expect(updated.provider).toBe('anthropic')
    expect(updated.credentialSource).toBeUndefined()
  })

  test('Given 非 codex provider 携带 codex-cli 标记 When createChannel Then 不落该标记', () => {
    const created = channelManager.createChannel({
      name: 'x',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'k',
      models: [],
      enabled: true,
      // 异常/恶意输入：非 codex provider 不应接受来源标记。
      credentialSource: 'codex-cli' as never,
    })
    expect(created.credentialSource).toBeUndefined()
  })
})
