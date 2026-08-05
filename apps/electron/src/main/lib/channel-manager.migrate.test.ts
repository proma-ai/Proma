import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV
const originalCwd = process.cwd()

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false, // 明文存储便于断言
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

/** 写一个含 MEMORY_LLM_API_KEY 的 .env 到指定目录 */
function writeDotEnv(dir: string, apiKey: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.env'), `MEMORY_LLM_API_KEY=${apiKey}\nMEMORY_LLM_BASE_URL=https://api.deepseek.com/anthropic\n`, 'utf-8')
}

function readChannels(): Array<Record<string, unknown>> {
  const raw = readFileSyncSafe(join(tempHome, '.proma', 'channels.json'))
  if (!raw) return []
  return (JSON.parse(raw).channels ?? []) as Array<Record<string, unknown>>
}

function readFileSyncSafe(path: string): string | null {
  try {
    return require('node:fs').readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-channel-migrate-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(tempHome, { recursive: true, force: true })
  mkdirSync(tempHome, { recursive: true })
  delete process.env.MEMORY_LLM_API_KEY
  delete process.env.MEMORY_LLM_BASE_URL
  // 切到临时目录，避免 getMemoryLlmConfig 读到项目根 .env 的真实凭证
  process.chdir(tempHome)
})

afterAll(() => {
  process.env.HOME = originalHome
  process.env.PROMA_DEV = originalPromaDev
  process.chdir(originalCwd)
  rmSync(tempHome, { recursive: true, force: true })
})

describe('channel-manager: DeepSeek 空 key 迁移', () => {
  test('listChannels 为历史空 key DeepSeek 渠道补填 .env 凭证', () => {
    writeChannels([
      {
        id: 'deepseek-1',
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: '',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    writeDotEnv(join(tempHome, '.proma'), 'sk-test-1234567890')

    const channels = channelManager.listChannels()
    const ds = channels.find((c) => c.id === 'deepseek-1')
    expect(ds?.apiKey).toBe('sk-test-1234567890')
    expect(ds?.enabled).toBe(true)
  })

  test('用户已填 key 的渠道不被覆盖', () => {
    writeChannels([
      {
        id: 'deepseek-1',
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-user-existing',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    writeDotEnv(join(tempHome, '.proma'), 'sk-test-1234567890')

    const channels = channelManager.listChannels()
    const ds = channels.find((c) => c.id === 'deepseek-1')
    expect(ds?.apiKey).toBe('sk-user-existing')
  })

  test('无 .env key 时保持空 key 且不报错', () => {
    writeChannels([
      {
        id: 'deepseek-1',
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: '',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    // 不写 .env

    const channels = channelManager.listChannels()
    const ds = channels.find((c) => c.id === 'deepseek-1')
    expect(ds?.apiKey).toBe('')
  })

  test('迁移结果已持久化到 channels.json', () => {
    writeChannels([
      {
        id: 'deepseek-1',
        name: 'DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: '',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    writeDotEnv(join(tempHome, '.proma'), 'sk-test-1234567890')

    channelManager.listChannels()
    const persisted = readChannels()
    const ds = persisted.find((c) => c.id === 'deepseek-1') as { apiKey: string } | undefined
    expect(ds?.apiKey).toBe('sk-test-1234567890')
  })
})
