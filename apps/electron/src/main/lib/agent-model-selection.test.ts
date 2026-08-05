import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type AgentModelSelection = typeof import('./agent-model-selection')

let selection: AgentModelSelection
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  nativeImage: { createFromPath: () => ({}) },
  nativeTheme: {},
  powerMonitor: {},
  powerSaveBlocker: {},
  screen: {},
  shell: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeChannels(channels: unknown[]): void {
  const dir = join(tempHome, '.proma-dev')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'channels.json'), JSON.stringify({ version: 2, channels }, null, 2), 'utf-8')
}

const anthropicChannel = {
  id: 'channel-anthropic',
  name: 'Anthropic 测试',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'dGVzdC1rZXk=',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  models: [
    { id: 'claude-opus-4', name: 'Claude Opus 4', enabled: true },
    { id: 'claude-disabled', name: 'Claude 禁用模型', enabled: false },
  ],
}

const openaiChannel = {
  id: 'channel-openai',
  name: 'OpenAI 测试',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'dGVzdC1rZXk=',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  models: [
    { id: 'gpt-5', name: 'GPT-5', enabled: true },
  ],
}

const disabledChannel = {
  id: 'channel-disabled',
  name: '未启用渠道',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'dGVzdC1rZXk=',
  enabled: false,
  createdAt: 0,
  updatedAt: 0,
  models: [
    { id: 'claude-sonnet', name: 'Claude Sonnet', enabled: true },
  ],
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-model-selection-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '1'
  selection = await import('./agent-model-selection')
})

afterAll(() => {
  process.env.HOME = originalHome
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

describe('listEnabledAgentModelsForChannel（单渠道，保持旧行为）', () => {
  test('返回指定渠道已启用模型', () => {
    writeChannels([anthropicChannel, openaiChannel])
    const result = selection.listEnabledAgentModelsForChannel('channel-anthropic', '测试')
    expect(result.channelId).toBe('channel-anthropic')
    expect(result.models.map((m) => m.id)).toEqual(['claude-opus-4'])
  })

  test('渠道不存在或未启用时抛错', () => {
    writeChannels([anthropicChannel])
    expect(() => selection.listEnabledAgentModelsForChannel('channel-openai', '测试')).toThrow('不存在或未启用')
    expect(() => selection.listEnabledAgentModelsForChannel('channel-disabled', '测试')).toThrow('不存在或未启用')
  })
})

describe('listAllEnabledAgentModels（跨渠道列表）', () => {
  test('只列出已启用渠道及其启用模型', () => {
    writeChannels([anthropicChannel, openaiChannel, disabledChannel])
    const channels = selection.listAllEnabledAgentModels()
    expect(channels).toHaveLength(2)
    const anthropic = channels.find((c) => c.channelId === 'channel-anthropic')
    expect(anthropic?.models.map((m) => m.id)).toEqual(['claude-opus-4'])
    const openai = channels.find((c) => c.channelId === 'channel-openai')
    expect(openai?.models.map((m) => m.id)).toEqual(['gpt-5'])
  })

  test('没有任何启用渠道时返回空数组', () => {
    writeChannels([disabledChannel])
    expect(selection.listAllEnabledAgentModels()).toEqual([])
  })

  test('agentRuntime=claude 时只返回 Anthropic 兼容渠道', () => {
    writeChannels([anthropicChannel, openaiChannel])
    const channels = selection.listAllEnabledAgentModels('claude')
    expect(channels).toHaveLength(1)
    expect(channels[0].channelId).toBe('channel-anthropic')
  })

  test('agentRuntime=pi 时返回全部启用渠道', () => {
    writeChannels([anthropicChannel, openaiChannel])
    const channels = selection.listAllEnabledAgentModels('pi')
    expect(channels.map((c) => c.channelId).sort()).toEqual(['channel-anthropic', 'channel-openai'])
  })
})

describe('assertEnabledModelForChannel（跨渠道模型校验）', () => {
  test('模型属于目标渠道且启用时通过', () => {
    writeChannels([anthropicChannel, openaiChannel])
    expect(
      selection.assertEnabledModelForChannel({
        channelId: 'channel-openai',
        modelId: 'gpt-5',
        purpose: '创建协作子会话',
      }),
    ).toBe('gpt-5')
  })

  test('模型不属于目标渠道时抛错（而非回退父渠道）', () => {
    writeChannels([anthropicChannel, openaiChannel])
    expect(() =>
      selection.assertEnabledModelForChannel({
        channelId: 'channel-openai',
        modelId: 'claude-opus-4',
        purpose: '创建协作子会话',
      }),
    ).toThrow('模型不属于渠道')
  })

  test('模型未启用时抛错', () => {
    writeChannels([anthropicChannel])
    expect(() =>
      selection.assertEnabledModelForChannel({
        channelId: 'channel-anthropic',
        modelId: 'claude-disabled',
        purpose: '创建协作子会话',
      }),
    ).toThrow('未启用')
  })
})

describe('assertEnabledModelForChannel 协议兼容校验（agentRuntime）', () => {
  test('claude runtime + Anthropic 兼容渠道通过', () => {
    writeChannels([anthropicChannel, openaiChannel])
    expect(
      selection.assertEnabledModelForChannel({
        channelId: 'channel-anthropic',
        modelId: 'claude-opus-4',
        purpose: '创建协作子会话',
        agentRuntime: 'claude',
      }),
    ).toBe('claude-opus-4')
  })

  test('claude runtime + OpenAI 渠道抛错（协议不兼容）', () => {
    writeChannels([anthropicChannel, openaiChannel])
    expect(() =>
      selection.assertEnabledModelForChannel({
        channelId: 'channel-openai',
        modelId: 'gpt-5',
        purpose: '创建协作子会话',
        agentRuntime: 'claude',
      }),
    ).toThrow('不兼容 Claude Agent Core')
  })

  test('pi runtime + OpenAI 渠道通过（Pi 支持多协议）', () => {
    writeChannels([anthropicChannel, openaiChannel])
    expect(
      selection.assertEnabledModelForChannel({
        channelId: 'channel-openai',
        modelId: 'gpt-5',
        purpose: '创建协作子会话',
        agentRuntime: 'pi',
      }),
    ).toBe('gpt-5')
  })

  test('不传 agentRuntime 时不做协议校验（向后兼容）', () => {
    writeChannels([anthropicChannel, openaiChannel])
    expect(
      selection.assertEnabledModelForChannel({
        channelId: 'channel-openai',
        modelId: 'gpt-5',
        purpose: '创建协作子会话',
      }),
    ).toBe('gpt-5')
  })
})
