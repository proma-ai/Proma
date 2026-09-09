/**
 * 受控的工作区 MCP 配置服务。
 *
 * Agent 通过此服务新增或更新不含凭据的 transport 配置；所有启用请求都会执行
 * MCP handshake + listTools 验证，并且仅在验证成功后写入 enabled=true。
 */

import type { McpServerEntry, McpTransportType, WorkspaceMcpConfig } from '@proma/shared'
import { getWorkspaceMcpConfig, saveWorkspaceMcpConfig } from './agent-workspace-manager'
import {
  buildWorkspaceMcpEntry,
  hasWorkspaceMcpTransportChanged,
  preserveSensitiveConnectionFields,
  requireWorkspaceMcpServerName,
  type ConfigureWorkspaceMcpInput,
} from './mcp-configuration-policy'
import { validateMcpServer } from './mcp-validator'

export type { ConfigureWorkspaceMcpInput } from './mcp-configuration-policy'

/** 每个工作区的 MCP 配置变更串行执行，避免并发读-改-写互相覆盖。 */
const workspaceMcpConfigMutationQueues = new Map<string, Promise<void>>()

async function withWorkspaceMcpConfigMutation<T>(workspaceSlug: string, action: () => Promise<T>): Promise<T> {
  const previous = workspaceMcpConfigMutationQueues.get(workspaceSlug) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.catch(() => undefined).then(() => current)
  workspaceMcpConfigMutationQueues.set(workspaceSlug, queued)
  await previous.catch(() => undefined)
  try {
    return await action()
  } finally {
    release()
    if (workspaceMcpConfigMutationQueues.get(workspaceSlug) === queued) {
      workspaceMcpConfigMutationQueues.delete(workspaceSlug)
    }
  }
}

export interface WorkspaceMcpServerSummary {
  name: string
  type: McpTransportType
  enabled: boolean
  verified: boolean
}

export interface ConfigureWorkspaceMcpResult extends WorkspaceMcpServerSummary {
  /** 本次调用是否基于已有同名条目更新。 */
  updatedExisting: boolean
  /** Pi customTools 在 run 启动时构建，因此本轮不会热更新。 */
  availableNextRun: boolean
}

function summarize(name: string, entry: McpServerEntry): WorkspaceMcpServerSummary {
  return {
    name,
    type: entry.type,
    enabled: entry.enabled,
    verified: entry.lastTestResult?.success === true,
  }
}

/** 仅返回无敏感连接详情，供 Agent 判断是否需要更新或引用某个 MCP。 */
export function listWorkspaceMcpServers(workspaceSlug: string): WorkspaceMcpServerSummary[] {
  const config = getWorkspaceMcpConfig(workspaceSlug)
  return Object.entries(config.servers).map(([name, entry]) => summarize(name, entry))
}

/**
 * 写入无凭据 transport 配置。启用请求先持久化为 disabled，真实握手和工具发现
 * 成功后才切换到 enabled，避免无效配置被下一轮 Agent 注入。
 */
export async function configureWorkspaceMcp(
  workspaceSlug: string,
  input: ConfigureWorkspaceMcpInput,
): Promise<ConfigureWorkspaceMcpResult> {
  return withWorkspaceMcpConfigMutation(workspaceSlug, async () => {
    const name = requireWorkspaceMcpServerName(input.name)
    const current = getWorkspaceMcpConfig(workspaceSlug)
    const existing = current.servers[name]
    // 省略 oauth 表示“不修改既有公开 OAuth 元数据”，以免普通 transport 更新破坏
    // 已可用的授权卡；显式传 oauth 才会替换该元数据。
    const requestedEntry: McpServerEntry = {
      ...buildWorkspaceMcpEntry(input),
      ...(input.oauth === undefined && existing?.oauth ? { oauth: existing.oauth } : {}),
    }
    if (existing && hasWorkspaceMcpTransportChanged(existing, requestedEntry) && input.replaceExisting !== true) {
      throw new Error(`MCP「${name}」已存在且连接配置不同；请先向用户说明影响并在确认后以 replaceExisting=true 重试`)
    }
    const entry = preserveSensitiveConnectionFields(existing, requestedEntry)
    const pendingEntry: McpServerEntry = { ...entry, enabled: false }
    const pendingConfig: WorkspaceMcpConfig = {
      servers: { ...current.servers, [name]: pendingEntry },
    }
    saveWorkspaceMcpConfig(workspaceSlug, pendingConfig)

    if (!entry.enabled) {
      return { ...summarize(name, pendingEntry), updatedExisting: Boolean(existing), availableNextRun: false }
    }

    const validation = await validateMcpServer(name, entry, workspaceSlug)
    const resolvedEntry: McpServerEntry = {
      ...entry,
      enabled: validation.valid,
      lastTestResult: {
        success: validation.valid,
        message: validation.valid ? (validation.message ?? 'MCP 连接成功') : (validation.reason ?? 'MCP 连接失败'),
        timestamp: Date.now(),
      },
    }
    saveWorkspaceMcpConfig(workspaceSlug, {
      servers: { ...getWorkspaceMcpConfig(workspaceSlug).servers, [name]: resolvedEntry },
    })

    return {
      ...summarize(name, resolvedEntry),
      updatedExisting: Boolean(existing),
      availableNextRun: validation.valid,
    }
  })
}
