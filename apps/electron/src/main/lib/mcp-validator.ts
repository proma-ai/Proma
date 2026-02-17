/**
 * MCP 服务器验证器
 *
 * 在将 MCP 服务器配置传递给 Agent SDK 之前，验证其可用性：
 * - stdio 类型：检查命令是否存在
 * - http/sse 类型：可选地 ping URL
 *
 * 避免配置错误的 MCP 服务器导致整个 Agent SDK 无法启动。
 */

import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import type { McpServerEntry } from '@proma/shared'

/**
 * MCP 验证结果
 */
export interface McpValidationResult {
  /** 服务器名称 */
  name: string
  /** 是否验证通过 */
  valid: boolean
  /** 失败原因（如果 valid 为 false） */
  reason?: string
}

/**
 * 验证单个 MCP 服务器配置
 *
 * @param name 服务器名称
 * @param entry MCP 服务器配置
 * @returns 验证结果
 */
export async function validateMcpServer(
  name: string,
  entry: McpServerEntry,
): Promise<McpValidationResult> {
  // stdio 类型：检查命令是否存在
  if (entry.type === 'stdio') {
    if (!entry.command) {
      return {
        name,
        valid: false,
        reason: '缺少 command 字段',
      }
    }

    // 检查命令是否可执行
    const commandValid = await isCommandAvailable(entry.command)
    if (!commandValid) {
      return {
        name,
        valid: false,
        reason: `命令不存在或不可执行: ${entry.command}`,
      }
    }

    return { name, valid: true }
  }

  // http/sse 类型：检查 URL 格式
  if (entry.type === 'http' || entry.type === 'sse') {
    if (!entry.url) {
      return {
        name,
        valid: false,
        reason: '缺少 url 字段',
      }
    }

    // 验证 URL 格式
    try {
      new URL(entry.url)
    } catch {
      return {
        name,
        valid: false,
        reason: `无效的 URL 格式: ${entry.url}`,
      }
    }

    // 可选：ping URL（简单的 HEAD 请求）
    // 由于可能会增加启动延迟，暂时跳过网络验证
    // 只做基本的格式检查

    return { name, valid: true }
  }

  return {
    name,
    valid: false,
    reason: `未知的传输类型: ${entry.type}`,
  }
}

/**
 * 检查命令是否可用
 *
 * 策略：
 * 1. 如果是绝对路径，检查文件是否存在
 * 2. 如果是相对命令（如 npx），使用 which 查找
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  // 绝对路径
  if (command.startsWith('/') || command.startsWith('\\') || /^[A-Z]:/i.test(command)) {
    return existsSync(command)
  }

  // 相对命令：使用 which 查找
  try {
    // 跨平台 which 查找
    const whichCommand = process.platform === 'win32' ? 'where' : 'which'
    execSync(`${whichCommand} ${command}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * 批量验证 MCP 服务器配置
 *
 * @param servers MCP 服务器配置对象
 * @returns 验证结果数组
 */
export async function validateMcpServers(
  servers: Record<string, McpServerEntry>,
): Promise<McpValidationResult[]> {
  const results: McpValidationResult[] = []

  for (const [name, entry] of Object.entries(servers)) {
    // 跳过未启用的服务器
    if (!entry.enabled) continue

    const result = await validateMcpServer(name, entry)
    results.push(result)
  }

  return results
}
