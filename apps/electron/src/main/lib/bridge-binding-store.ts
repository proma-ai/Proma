/**
 * IM Bridge 聊天绑定持久化工具。
 *
 * 用于钉钉/微信等共享 BridgeCommandHandler 的平台，将外部 chatId
 * 与 Proma Agent sessionId 的映射保存到本地 JSON 文件。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { BridgeChatBinding } from './bridge-command-handler'
import { redactSensitiveLogValue } from './bridge-log-redaction'

export interface BridgeChatBindingStore {
  load(): BridgeChatBinding[]
  save(bindings: BridgeChatBinding[]): void
}

export function createJsonBridgeChatBindingStore(filePath: string, logPrefix: string): BridgeChatBindingStore {
  return {
    load: () => loadBridgeChatBindings(filePath, logPrefix),
    save: (bindings) => saveBridgeChatBindings(filePath, bindings, logPrefix),
  }
}

export function loadBridgeChatBindings(filePath: string, logPrefix: string): BridgeChatBinding[] {
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      console.warn(`[${logPrefix}] 绑定文件格式无效，已忽略`)
      return []
    }

    return parsed.filter(isBridgeChatBinding)
  } catch (error) {
    console.error(`[${logPrefix}] 加载聊天绑定失败:`, redactSensitiveLogValue(error))
    return []
  }
}

export function saveBridgeChatBindings(filePath: string, bindings: BridgeChatBinding[], logPrefix: string): void {
  try {
    writeFileSync(filePath, JSON.stringify(bindings, null, 2), 'utf-8')
  } catch (error) {
    console.error(`[${logPrefix}] 保存聊天绑定失败:`, redactSensitiveLogValue(error))
  }
}

export function filterExistingBridgeBindings(
  bindings: BridgeChatBinding[],
  hasSession: (sessionId: string) => boolean,
): BridgeChatBinding[] {
  return bindings.filter((binding) => hasSession(binding.sessionId))
}

function isBridgeChatBinding(value: unknown): value is BridgeChatBinding {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.chatId === 'string'
    && typeof record.sessionId === 'string'
    && typeof record.workspaceId === 'string'
    && typeof record.channelId === 'string'
    && (record.modelId === undefined || typeof record.modelId === 'string')
}
