import { describe, expect, mock, test } from 'bun:test'

const noop = (): void => {}
const electronStub = {
  app: {
    getPath: () => '/tmp/proma-collaboration-test',
    getAppPath: () => '/tmp/proma-collaboration-test',
    isPackaged: false,
    on: noop,
  },
  BrowserWindow: class BrowserWindow {},
  clipboard: {},
  dialog: {},
  globalShortcut: {},
  ipcMain: {},
  nativeImage: {},
  nativeTheme: {},
  net: {},
  powerMonitor: {},
  powerSaveBlocker: {},
  safeStorage: {},
  screen: {},
  shell: {},
  systemPreferences: {},
}

mock.module('electron', () => electronStub)

const collaborationContext = {
  sessionId: 'parent-session',
  channelId: 'channel-id',
  workspaceId: 'workspace-id',
} as const

describe('协作委派续跑工具注册', () => {
  test('Claude runtime 同时保留同步工具并暴露异步工具', async () => {
    const { injectAgentCollaborationMcpServer } = await import('./agent-collaboration-tools')
    const sdk = {
      tool(name: string): { name: string } {
        return { name }
      },
      createSdkMcpServer(input: { tools: Array<{ name: string }> }): { tools: Array<{ name: string }> } {
        return input
      },
    }
    const servers: Record<string, Record<string, unknown>> = {}

    await injectAgentCollaborationMcpServer(
      sdk as unknown as typeof import('@anthropic-ai/claude-agent-sdk'),
      servers,
      collaborationContext,
    )

    const server = servers.collaboration as { tools: Array<{ name: string }> }
    const names = server.tools.map((tool) => tool.name)
    expect(names).toContain('continue_delegation')
    expect(names).toContain('continue_delegation_async')
  })

  test('Pi runtime 同时保留同步工具并暴露异步工具', async () => {
    const { buildPiCollaborationTools } = await import('./agent-collaboration-tools')
    const sdk = {
      defineTool<T>(tool: T): T {
        return tool
      },
    }

    const tools = buildPiCollaborationTools(
      sdk as unknown as typeof import('@earendil-works/pi-coding-agent'),
      collaborationContext,
    ) as Array<{ name: string }>
    const names = tools.map((tool) => tool.name)

    expect(names).toContain('mcp__collaboration__continue_delegation')
    expect(names).toContain('mcp__collaboration__continue_delegation_async')
  })
})
