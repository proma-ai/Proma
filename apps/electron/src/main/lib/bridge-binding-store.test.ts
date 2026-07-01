import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createJsonBridgeChatBindingStore,
  filterExistingBridgeBindings,
  loadBridgeChatBindings,
} from './bridge-binding-store'
import type { BridgeChatBinding } from './bridge-command-handler'

let tempDir: string | null = null

function tempFile(name: string): string {
  if (!tempDir) {
    tempDir = mkdtempSync(join(tmpdir(), 'proma-bridge-bindings-'))
  }
  return join(tempDir, name)
}

afterEach(() => {
  if (!tempDir) return
  rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('bridge binding store', () => {
  test('Given 有效绑定 When 保存并加载 Then 保留 chatId 到 sessionId 的映射', () => {
    const filePath = tempFile('bindings.json')
    const store = createJsonBridgeChatBindingStore(filePath, '测试 Bridge')
    const bindings: BridgeChatBinding[] = [
      {
        chatId: 'ding-conversation-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
        modelId: 'model-1',
      },
    ]

    store.save(bindings)

    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual(bindings)
    expect(store.load()).toEqual(bindings)
  })

  test('Given 绑定文件混入无效项 When 加载 Then 只返回结构完整的绑定', () => {
    const filePath = tempFile('mixed.json')
    const valid: BridgeChatBinding = {
      chatId: 'chat-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
    }
    writeFileSync(filePath, JSON.stringify([
      valid,
      { chatId: 'missing-session', workspaceId: 'workspace-1', channelId: 'channel-1' },
      {
        chatId: 'bad-model',
        sessionId: 'session-2',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
        modelId: 42,
      },
    ]), 'utf-8')

    expect(loadBridgeChatBindings(filePath, '测试 Bridge')).toEqual([valid])
  })

  test('Given 旧绑定指向已删除会话 When 过滤 Then 只恢复仍存在的会话', () => {
    const bindings: BridgeChatBinding[] = [
      { chatId: 'chat-1', sessionId: 'alive', workspaceId: 'workspace-1', channelId: 'channel-1' },
      { chatId: 'chat-2', sessionId: 'deleted', workspaceId: 'workspace-1', channelId: 'channel-1' },
    ]

    expect(filterExistingBridgeBindings(bindings, (sessionId) => sessionId === 'alive')).toEqual([bindings[0]!])
  })
})
