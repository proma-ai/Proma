/**
 * Chat 工具配置服务
 *
 * 管理 ~/.proma/chat-tools.json 的读写。
 * 管理 Agent 模式推荐和自定义 HTTP 工具。旧凭据字段仅透传保留，不再执行旧搜索或生图能力。
 */

import { readFileSync, existsSync } from 'node:fs'
import { getChatToolsConfigPath } from './config-paths'
import { writeJsonFileAtomic } from './safe-file'
import type { ChatToolsFileConfig, ChatToolState, ChatToolMeta } from '@proma/shared'

/** 默认配置 */
const DEFAULT_CONFIG: ChatToolsFileConfig = {
  toolStates: {
    memory: { enabled: true },
    'agent-mode-recommend': { enabled: true },
  },
  toolCredentials: {},
  customTools: [],
}

/**
 * 读取工具配置
 */
export function getChatToolsConfig(): ChatToolsFileConfig {
  const filePath = getChatToolsConfigPath()

  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_CONFIG)
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<ChatToolsFileConfig>
    return {
      toolStates: { ...DEFAULT_CONFIG.toolStates, ...data.toolStates },
      toolCredentials: data.toolCredentials ?? {},
      customTools: data.customTools ?? [],
    }
  } catch (error) {
    console.error('[Chat 工具配置] 读取失败:', error)
    return structuredClone(DEFAULT_CONFIG)
  }
}

/**
 * 保存工具配置
 */
export function saveChatToolsConfig(config: ChatToolsFileConfig): void {
  const filePath = getChatToolsConfigPath()
  try {
    writeJsonFileAtomic(filePath, config)
    console.log('[Chat 工具配置] 已保存')
  } catch (error) {
    console.error('[Chat 工具配置] 保存失败:', error)
    throw new Error('保存 Chat 工具配置失败')
  }
}

/**
 * 更新单个工具的开关状态
 */
export function updateToolState(toolId: string, state: ChatToolState): void {
  const config = getChatToolsConfig()
  config.toolStates[toolId] = state
  saveChatToolsConfig(config)
}

/**
 * 添加自定义工具
 */
export function addCustomTool(meta: ChatToolMeta): void {
  const config = getChatToolsConfig()
  // 去重
  config.customTools = config.customTools.filter((t) => t.id !== meta.id)
  config.customTools.push(meta)
  config.toolStates[meta.id] = { enabled: false }
  saveChatToolsConfig(config)
}

/**
 * 删除自定义工具
 */
export function deleteCustomTool(toolId: string): void {
  const config = getChatToolsConfig()
  config.customTools = config.customTools.filter((t) => t.id !== toolId)
  delete config.toolStates[toolId]
  delete config.toolCredentials[toolId]
  saveChatToolsConfig(config)
}
