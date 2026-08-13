import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import {
  PROMA_OFFICIAL_CHANNEL_ID,
  PROVIDER_DEFAULT_URLS,
  serializeCodexCredentials,
} from '@proma/shared'
import type { ProviderType } from '@proma/shared'

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
  // channel-manager 依赖的 billing service 会导入 BrowserWindow；本测试不触发广播。
  BrowserWindow: {
    getAllWindows: () => [],
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
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
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

describe('商业版渠道准入与中转站清理', () => {
  test('Given 存量第三方中转站 When 读取渠道 Then 删除并原子回写仅保留官方 API', () => {
    writeChannels([
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'official-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'relay-channel',
        name: '第三方中转',
        provider: 'custom',
        baseUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'rewritten-openai',
        name: '伪装 OpenAI',
        provider: 'openai',
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(channelManager.listChannels().map((channel) => channel.id)).toEqual(['deepseek-official'])

    const persisted = JSON.parse(readFileSync(join(tempHome, '.proma', 'channels.json'), 'utf-8')) as {
      version: number
      channels: Array<{ id: string }>
    }
    expect(persisted.version).toBe(5)
    expect(persisted.channels.map((channel) => channel.id)).toEqual(['deepseek-official'])
  })

  test('Given 第三方中转站输入 When 创建或直连探测 Then 主进程拒绝且不落库', async () => {
    const input = {
      name: '第三方中转',
      provider: 'custom' as const,
      baseUrl: 'https://relay.example.com/v1/chat/completions',
      apiKey: 'relay-key',
      models: [],
      enabled: true,
    }

    expect(() => channelManager.createChannel(input)).toThrow('已禁用第三方中转站')
    await expect(channelManager.testChannelDirect(input)).resolves.toMatchObject({ success: false, message: expect.stringContaining('已禁用第三方中转站') })
    await expect(channelManager.fetchModels(input)).resolves.toMatchObject({ success: false, models: [], message: expect.stringContaining('已禁用第三方中转站') })
  })

  test('Given 内置供应商默认地址 When 创建渠道 Then 正常保留，任何地址改写均拒绝', () => {
    const channel = channelManager.createChannel({
      name: 'OpenAI',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'official-key',
      models: [],
      enabled: true,
    })

    expect(channel.baseUrl).toBe('https://api.openai.com/v1')
    expect(channelManager.getChannelById(channel.id)?.provider).toBe('openai')
    expect(() => channelManager.updateChannel(channel.id, { baseUrl: 'https://api.openai.com/v1/proxy' }))
      .toThrow('已禁用第三方中转站')
  })

  test('Given 官方域名但非默认地址的历史渠道 When 读取渠道 Then 仍删除', () => {
    writeChannels([
      {
        id: 'rewritten-path',
        name: '改写路径的 OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1/proxy',
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(channelManager.listChannels().map((channel) => channel.provider)).toEqual(['deepseek'])
  })

  test('Given 所有内置渠道默认地址（含尾斜杠） When 读取渠道 Then 全部保留', () => {
    const providers: ProviderType[] = [
      'anthropic', 'openai', 'openai-responses', 'deepseek', 'google', 'kimi-api', 'kimi-coding',
      'opencode-go-openai', 'zhipu', 'zhipu-coding', 'zhipu-coding-team', 'ark-coding-plan',
      'minimax', 'doubao', 'qwen', 'qwen-anthropic', 'qwen-token-plan', 'xiaomi', 'xiaomi-token-plan',
      'openai-codex', 'xai',
    ]
    writeChannels(providers.map((provider, index) => ({
      id: `builtin-${provider}`,
      name: provider,
      provider,
      baseUrl: PROVIDER_DEFAULT_URLS[provider] ? `${PROVIDER_DEFAULT_URLS[provider]}/` : '',
      apiKey: 'official-key',
      models: [],
      enabled: true,
      createdAt: index,
      updatedAt: index,
    })))

    const remainingProviderIds = new Set(channelManager.listChannels().map((channel) => channel.id))
    for (const provider of providers) {
      expect(remainingProviderIds.has(`builtin-${provider}`)).toBe(true)
    }
  })

  test('Given OpenCode Go 的默认地址 When 读取或创建渠道 Then 保留，改写地址仍拒绝', () => {
    writeChannels([
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        provider: 'opencode-go-openai',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKey: 'official-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(channelManager.listChannels().some((channel) => channel.id === 'opencode-go')).toBe(true)
    expect(() => channelManager.createChannel({
      name: '改写的 OpenCode Go',
      provider: 'opencode-go-openai',
      baseUrl: 'https://opencode.ai/zen/go/v1/proxy',
      apiKey: 'relay-key',
      models: [],
      enabled: true,
    })).toThrow('已禁用第三方中转站')
  })

  test('Given Proma 官方固定 ID 被伪造 When 读取渠道 Then 删除伪造记录并保留完整官方身份', () => {
    writeChannels([
      {
        id: PROMA_OFFICIAL_CHANNEL_ID,
        name: '伪装官方',
        provider: 'openai',
        baseUrl: PROVIDER_DEFAULT_URLS.openai,
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'real-official',
        name: 'Proma 官方',
        provider: 'proma',
        baseUrl: '',
        apiKey: '',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(channelManager.listChannels().some((channel) => channel.id === PROMA_OFFICIAL_CHANNEL_ID)).toBe(false)

    writeChannels([
      {
        id: PROMA_OFFICIAL_CHANNEL_ID,
        name: 'Proma 官方',
        provider: 'proma',
        baseUrl: '',
        apiKey: '',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    expect(channelManager.listChannels().some((channel) => channel.id === PROMA_OFFICIAL_CHANNEL_ID)).toBe(true)
  })
})

describe('渠道移除通知', () => {
  test('Given 启动时清理了第三方中转站 When 消费通知 Then 返回被移除渠道且读取即清除', () => {
    writeChannels([
      {
        id: 'relay-channel',
        name: '第三方中转',
        provider: 'custom',
        baseUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    // 触发一次 readConfig 完成清理，并记录移除通知。
    channelManager.listChannels()

    const notice = channelManager.consumeChannelRemovalNotice()
    expect(notice?.channels).toEqual([{ name: '第三方中转', provider: 'custom' }])

    // 读取即清除：再消费一次应该返回 null。
    expect(channelManager.consumeChannelRemovalNotice()).toBeNull()
  })

  test('Given 没有任何渠道被移除 When 消费通知 Then 返回 null', () => {
    writeChannels([
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'official-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    channelManager.listChannels()
    expect(channelManager.consumeChannelRemovalNotice()).toBeNull()
  })

  test('Given 连续两次启动均清理到第三方渠道且均未消费 When 消费通知 Then 按 provider+name 去重合并', () => {
    writeChannels([
      {
        id: 'relay-a',
        name: '第三方中转 A',
        provider: 'custom',
        baseUrl: 'https://relay-a.example.com/v1/chat/completions',
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    channelManager.listChannels()

    writeChannels([
      {
        id: 'relay-a',
        name: '第三方中转 A',
        provider: 'custom',
        baseUrl: 'https://relay-a.example.com/v1/chat/completions',
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'relay-b',
        name: '第三方中转 B',
        provider: 'anthropic-compatible',
        baseUrl: 'https://relay-b.example.com/v1/messages',
        apiKey: 'relay-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    channelManager.listChannels()

    const notice = channelManager.consumeChannelRemovalNotice()
    expect(notice?.channels).toEqual([
      { name: '第三方中转 A', provider: 'custom' },
      { name: '第三方中转 B', provider: 'anthropic-compatible' },
    ])
  })
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
