/**
 * 系统提示词管理服务
 *
 * 管理 Chat 模式的系统提示词 CRUD。
 * 存储在 ~/.proma/system-prompts.json
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getSystemPromptsPath } from './config-paths'
import {
  BUILTIN_DEFAULT_ID,
  BUILTIN_DEFAULT_PROMPT,
} from '@proma/shared'
import type {
  SystemPrompt,
  SystemPromptConfig,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
} from '@proma/shared'

/** 默认配置 */
function getDefaultConfig(): SystemPromptConfig {
  return {
    prompts: [{ ...BUILTIN_DEFAULT_PROMPT }],
    defaultPromptId: BUILTIN_DEFAULT_ID,
    appendDateTimeAndUserName: true,
  }
}

/** 读取配置文件 */
function readConfig(): SystemPromptConfig {
  const filePath = getSystemPromptsPath()

  if (!existsSync(filePath)) {
    return getDefaultConfig()
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as SystemPromptConfig

    // 确保内置提示词始终存在，且内容与源码保持同步
    const builtinIndex = data.prompts.findIndex((p) => p.id === BUILTIN_DEFAULT_ID)
    if (builtinIndex === -1) {
      data.prompts.unshift({ ...BUILTIN_DEFAULT_PROMPT })
    } else {
      // 始终用源码中的最新内容覆盖，防止文件中残留旧版本
      data.prompts[builtinIndex] = { ...BUILTIN_DEFAULT_PROMPT }
    }

    return {
      prompts: data.prompts,
      defaultPromptId: data.defaultPromptId,
      appendDateTimeAndUserName: data.appendDateTimeAndUserName ?? true,
    }
  } catch (error) {
    console.error('[系统提示词] 读取配置失败:', error)
    return getDefaultConfig()
  }
}

/** 写入配置文件 */
function writeConfig(config: SystemPromptConfig): void {
  const filePath = getSystemPromptsPath()

  try {
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[系统提示词] 写入配置失败:', error)
    throw new Error('写入系统提示词配置失败')
  }
}

/**
 * 获取系统提示词配置
 */
export function getSystemPromptConfig(): SystemPromptConfig {
  return readConfig()
}

/**
 * 创建自定义提示词
 */
export function createSystemPrompt(input: SystemPromptCreateInput): SystemPrompt {
  const config = readConfig()
  const now = Date.now()

  const prompt: SystemPrompt = {
    id: randomUUID(),
    name: input.name,
    content: input.content,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  }

  config.prompts.push(prompt)
  writeConfig(config)
  console.log(`[系统提示词] 已创建: ${prompt.name} (${prompt.id})`)
  return prompt
}

/**
 * 更新提示词
 *
 * 内置提示词不可编辑。
 */
export function updateSystemPrompt(id: string, input: SystemPromptUpdateInput): SystemPrompt {
  const config = readConfig()
  const index = config.prompts.findIndex((p) => p.id === id)

  if (index === -1) {
    throw new Error(`提示词不存在: ${id}`)
  }

  const prompt = config.prompts[index]!
  if (prompt.isBuiltin) {
    throw new Error('内置提示词不可编辑')
  }

  if (input.name !== undefined) prompt.name = input.name
  if (input.content !== undefined) prompt.content = input.content
  prompt.updatedAt = Date.now()

  writeConfig(config)
  console.log(`[系统提示词] 已更新: ${prompt.name} (${prompt.id})`)
  return prompt
}

/**
 * 删除提示词
 *
 * 内置提示词不可删除。
 * 如果被删除的是当前默认提示词，重置为内置默认。
 */
export function deleteSystemPrompt(id: string): void {
  const config = readConfig()
  const prompt = config.prompts.find((p) => p.id === id)

  if (!prompt) {
    throw new Error(`提示词不存在: ${id}`)
  }

  if (prompt.isBuiltin) {
    throw new Error('内置提示词不可删除')
  }

  config.prompts = config.prompts.filter((p) => p.id !== id)

  // 如果被删除的是默认提示词，重置为内置默认
  if (config.defaultPromptId === id) {
    config.defaultPromptId = BUILTIN_DEFAULT_ID
  }

  writeConfig(config)
  console.log(`[系统提示词] 已删除: ${prompt.name} (${id})`)
}

/**
 * 更新追加日期时间和用户名开关
 */
export function updateAppendSetting(enabled: boolean): void {
  const config = readConfig()
  config.appendDateTimeAndUserName = enabled
  writeConfig(config)
  console.log(`[系统提示词] 追加设置已更新: ${enabled}`)
}

/**
 * 设置默认提示词
 *
 * 传入 null 清除自定义默认（回退到内置默认）。
 */
export function setDefaultPrompt(id: string | null): void {
  const config = readConfig()

  if (id !== null) {
    const exists = config.prompts.some((p) => p.id === id)
    if (!exists) {
      throw new Error(`提示词不存在: ${id}`)
    }
  }

  config.defaultPromptId = id ?? BUILTIN_DEFAULT_ID
  writeConfig(config)
  console.log(`[系统提示词] 默认提示词已设置: ${config.defaultPromptId}`)
}
