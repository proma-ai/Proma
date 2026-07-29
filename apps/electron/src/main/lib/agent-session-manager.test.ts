import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type AgentSessionManager = typeof import('./agent-session-manager')
type AgentSessionContextPrompt = typeof import('./agent-session-context-prompt')

let manager: AgentSessionManager
let contextPrompt: AgentSessionContextPrompt
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

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

function jsonl(rows: string[]): string {
  return rows.join('\n') + '\n'
}

function writeAgentSessionJsonl(sessionId: string, rows: string[]): void {
  const dir = join(tempHome, '.proma', 'agent-sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), jsonl(rows), 'utf-8')
}

function writeSdkSessionJsonl(sdkSessionId: string, rows: string[]): void {
  const dir = join(tempHome, '.proma', 'sdk-config', 'projects', 'test-project')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sdkSessionId}.jsonl`), jsonl(rows), 'utf-8')
}

function writeAgentSessionsIndex(sessions: Array<{
  id: string
  title: string
  workspaceId: string
  createdAt: number
  updatedAt: number
}>): void {
  const dir = join(tempHome, '.proma')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({ version: 1, sessions }), 'utf-8')
}

function writeAgentWorkspacesIndex(workspaces: Array<{
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}>): void {
  const dir = join(tempHome, '.proma')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-workspaces.json'), JSON.stringify({ version: 2, workspaces }), 'utf-8')
}

function createIndexedSessions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    title: `会话 ${index}`,
    workspaceId: 'workspace-a',
    createdAt: index,
    updatedAt: index,
  }))
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-agent-session-manager-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  delete process.env.CLAUDE_CONFIG_DIR
  manager = await import('./agent-session-manager')
  contextPrompt = await import('./agent-session-context-prompt')
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
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Agent 会话 JSONL 读取', () => {
  test('Given 会话 JSONL 混入损坏行 When 读取 SDKMessage Then 跳过坏行并保留其它消息', () => {
    writeAgentSessionJsonl('session-with-bad-line', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '你好' }] }, parent_tool_use_id: null }),
      '{ 这不是合法 JSON',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '仍然可读' }] }, parent_tool_use_id: null }),
    ])

    const messages = manager.getAgentSessionSDKMessages('session-with-bad-line')

    expect(messages.map((message) => message.type)).toEqual(['user', 'assistant'])
  })

  test('Given SDK rewind JSONL 存在损坏行 When 从快照恢复文件 Then 严格失败避免误报成功', () => {
    const cwd = join(tempHome, 'workspace')
    mkdirSync(cwd, { recursive: true })
    writeSdkSessionJsonl('sdk-session-with-bad-line', [
      JSON.stringify({ type: 'user', uuid: 'user-1', message: { content: [{ type: 'text', text: '修改文件' }] } }),
      '{ 这不是合法 JSON',
      JSON.stringify({
        type: 'file-history-snapshot',
        isSnapshotUpdate: false,
        snapshot: {
          messageId: 'user-1',
          trackedFileBackups: {
            'a.txt': { backupFileName: null },
          },
        },
      }),
    ])

    const result = manager.rewindFilesFromSnapshot('sdk-session-with-bad-line', 'user-1', cwd)

    expect(result.canRewind).toBe(false)
    expect(result.error).toContain('JSONL 第 2 行解析失败')
  })

  test('Given 会话 JSONL 存在损坏行 When 截断 SDKMessage Then 抛错避免重写不完整历史', () => {
    writeAgentSessionJsonl('session-truncate-bad-line', [
      JSON.stringify({ type: 'assistant', uuid: 'assistant-1', message: { content: [{ type: 'text', text: '完成' }] } }),
      '{ 这不是合法 JSON',
    ])

    expect(() => manager.truncateSDKMessages('session-truncate-bad-line', 'assistant-1'))
      .toThrow('JSONL 第 2 行解析失败')
  })
})

describe('Agent 会话 runtime 元数据', () => {
  test('Given 已保存 OpenAI medium 默认值 When 新建 Pi 或 Claude 会话 Then 默认并持久化 medium', () => {
    const settingsPath = join(tempHome, '.proma', 'settings.json')
    mkdirSync(join(tempHome, '.proma'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({
      agentThinking: { type: 'adaptive' },
      agentEffort: 'max',
      defaultOpenAIThinkingLevel: 'medium',
    }), 'utf-8')

    try {
      const defaultRuntimeSession = manager.createAgentSession('默认内核会话')
      const claudeRuntimeSession = manager.createAgentSession('Claude 内核会话', undefined, undefined, undefined, 'claude')

      expect(defaultRuntimeSession.agentRuntime).toBe('pi')
      expect(claudeRuntimeSession.agentRuntime).toBe('claude')
      expect(manager.getAgentSessionMeta(defaultRuntimeSession.id)?.agentRuntime).toBe('pi')
      expect(manager.getAgentSessionMeta(claudeRuntimeSession.id)?.agentRuntime).toBe('claude')
      expect(defaultRuntimeSession.reasoningLevel).toBe('medium')
      expect(claudeRuntimeSession.reasoningLevel).toBe('medium')
      expect(manager.getAgentSessionMeta(defaultRuntimeSession.id)?.reasoningLevel).toBe('medium')
      expect(manager.getAgentSessionMeta(claudeRuntimeSession.id)?.reasoningLevel).toBe('medium')
    } finally {
      rmSync(settingsPath, { force: true })
    }
  })

  test('Given 新安装用户保存关闭思考 When 连续新建会话 Then 不被旧版迁移改回 high', () => {
    const settingsPath = join(tempHome, '.proma', 'settings.json')
    const indexPath = join(tempHome, '.proma', 'agent-sessions.json')
    const indexBackupPath = `${indexPath}.bak`
    mkdirSync(join(tempHome, '.proma'), { recursive: true })
    rmSync(indexPath, { force: true })
    rmSync(indexBackupPath, { force: true })
    writeFileSync(settingsPath, JSON.stringify({
      agentThinking: { type: 'adaptive' },
      agentEffort: 'medium',
      defaultOpenAIThinkingLevel: 'off',
    }), 'utf-8')

    try {
      const firstSession = manager.createAgentSession('关闭思考会话一')
      const secondSession = manager.createAgentSession('关闭思考会话二')

      expect(manager.getAgentSessionMeta(firstSession.id)?.reasoningLevel).toBe('off')
      expect(manager.getAgentSessionMeta(secondSession.id)?.reasoningLevel).toBe('off')
    } finally {
      rmSync(settingsPath, { force: true })
      rmSync(indexPath, { force: true })
      rmSync(indexBackupPath, { force: true })
    }
  })

  test('Given session settings When updating Then persists reasoning depth per session', () => {
    const session = manager.createAgentSession('Codex 会话', undefined, undefined, undefined, 'pi')

    const updated = manager.updateAgentSessionMeta(session.id, { reasoningLevel: 'xhigh' })

    expect(updated.reasoningLevel).toBe('xhigh')
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({ reasoningLevel: 'xhigh' })
  })

  test('Given a session When star state is updated Then it persists without changing freshness or archive state', () => {
    const session = manager.createAgentSession('星标会话')
    const archived = manager.updateAgentSessionMeta(session.id, { archived: true })

    const updated = manager.updateAgentSessionMeta(session.id, { starred: true })

    expect(updated).toMatchObject({ starred: true, archived: true })
    expect(updated.updatedAt).toBe(archived.updatedAt)
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({ starred: true, archived: true })
  })
})

describe('Agent 会话引用搜索', () => {
  test('Given 工作区有超过 20 个会话 When 请求最近 200 条 Then 按更新时间返回 200 条', async () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 200,
    })

    expect(results).toHaveLength(200)
    expect(results[0]?.sessionId).toBe('session-219')
    expect(results.at(-1)?.sessionId).toBe('session-20')
    expect(results.every((result) => result.matchSource === 'recent')).toBe(true)
  })

  test('Given 请求数量超过性能上限 When 搜索可引用会话 Then 最多返回 200 条', async () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 500,
    })

    expect(results).toHaveLength(200)
  })

  test('Given 未指定工作区 When 搜索可引用会话 Then 返回全部工作区的最近会话并标示来源', async () => {
    writeAgentWorkspacesIndex([
      { id: 'workspace-a', name: '产品研发', slug: 'product-dev', createdAt: 1, updatedAt: 1 },
      { id: 'workspace-b', name: '客户支持', slug: 'customer-support', createdAt: 2, updatedAt: 2 },
      { id: 'workspace-c', name: '当前项目', slug: 'current-project', createdAt: 3, updatedAt: 3 },
    ])
    writeAgentSessionsIndex([
      { id: 'workspace-a-session', title: '同名会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'workspace-b-session', title: '同名会话', workspaceId: 'workspace-b', createdAt: 2, updatedAt: 2 },
      { id: 'current-session', title: '当前会话', workspaceId: 'workspace-c', createdAt: 3, updatedAt: 3 },
    ])

    const results = await manager.searchAgentSessionReferences({
      excludeSessionId: 'current-session',
      limit: 200,
    })

    expect(results).toMatchObject([
      { sessionId: 'workspace-b-session', workspaceName: '客户支持', workspaceSlug: 'customer-support' },
      { sessionId: 'workspace-a-session', workspaceName: '产品研发', workspaceSlug: 'product-dev' },
    ])
  })

  test('Given 消息内容命中 When 搜索可引用会话 Then 异步返回匹配片段和工作区来源', async () => {
    writeAgentWorkspacesIndex([
      { id: 'workspace-b', name: '客户支持', slug: 'customer-support', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionsIndex([
      { id: 'message-session', title: '项目讨论', workspaceId: 'workspace-b', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionJsonl('message-session', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '需要核对跨工作区的会话引用。' }] } }),
    ])

    const results = await manager.searchAgentSessionReferences({ query: '跨工作区' })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      sessionId: 'message-session',
      workspaceName: '客户支持',
      workspaceSlug: 'customer-support',
      matchSource: 'message',
      snippet: expect.stringContaining('跨工作区'),
    })
  })

  test('Given 正文扫描预算耗尽 When 较旧会话标题命中 Then 仍返回标题命中结果', async () => {
    const scannedSessions = Array.from({ length: 50 }, (_, index) => ({
      id: `body-scan-${index}`,
      title: `普通会话 ${index}`,
      workspaceId: 'workspace-a',
      createdAt: 100 - index,
      updatedAt: 100 - index,
    }))
    writeAgentSessionsIndex([
      ...scannedSessions,
      { id: 'older-title-match', title: '目标会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
    ])
    for (const session of scannedSessions) {
      writeAgentSessionJsonl(session.id, [
        JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '没有匹配内容' }] } }),
      ])
    }

    const results = await manager.searchAgentSessionReferences({ query: '目标' })

    expect(results).toMatchObject([{ sessionId: 'older-title-match', matchSource: 'title' }])
  })

  test('Given 正文命中在单文件扫描上限之后 When 搜索引用 Then 不读取超出输入补全预算的历史', async () => {
    writeAgentSessionsIndex([
      { id: 'oversized-session', title: '大历史', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionJsonl('oversized-session', [
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: `${'x'.repeat(300 * 1024)}隐藏关键词` }] },
      }),
    ])

    const results = await manager.searchAgentSessionReferences({ query: '隐藏关键词' })

    expect(results).toEqual([])
  })
})

describe('Agent 会话引用 prompt', () => {
  test('Given 用户显式引用跨工作区会话 When 构建发送 prompt Then 保留该会话上下文', () => {
    writeAgentSessionsIndex([
      { id: 'current-session', title: '当前工作区会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'other-workspace-session', title: '其他工作区会话', workspaceId: 'workspace-b', createdAt: 2, updatedAt: 2 },
    ])

    const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string }
    const originalResourcesPath = processWithResourcesPath.resourcesPath
    processWithResourcesPath.resourcesPath = tempHome
    try {
      const prompt = contextPrompt.buildReferencedSessionsPrompt(
        'current-session',
        ['other-workspace-session'],
      )

      expect(prompt).toContain('id="other-workspace-session"')
      expect(prompt).toContain('title="其他工作区会话"')
      expect(prompt).not.toContain('同工作区')
    } finally {
      Object.defineProperty(processWithResourcesPath, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
        writable: true,
      })
    }
  })
})
