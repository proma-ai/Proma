/**
 * Agent 系统 Prompt 构建器
 *
 * 负责构建 Agent 的 system prompt 追加内容和每条消息的动态上下文。
 *
 * 设计策略（参考 Craft Agent OSS）：
 * - 静态 system prompt（buildSystemPromptAppend）：保持不变以利用 prompt caching
 * - 动态 per-message 上下文（buildDynamicContext）：注入到用户消息前，每次实时读取磁盘
 */

import { getUserProfile } from './user-profile-service'
import { getWorkspaceMcpConfig, getWorkspaceSkills } from './agent-workspace-manager'

// ===== 静态 System Prompt =====

/** buildSystemPromptAppend 所需的上下文 */
interface SystemPromptContext {
  workspaceName?: string
  workspaceSlug?: string
  sessionId: string
}

/**
 * 构建静态 system prompt 追加内容
 *
 * 拼接 Agent 角色定义、用户信息、工作区结构说明和交互规范。
 * 内容保持稳定以利用 Anthropic prompt caching。
 */
export function buildSystemPromptAppend(ctx: SystemPromptContext): string {
  const profile = getUserProfile()
  const userName = profile.userName || '用户'

  const sections: string[] = []

  // Agent 角色定义
  sections.push(`## Proma Agent

你是 Proma Agent — 一个集成在 Proma 桌面应用中的通用AI助手，你有极强的自主性和主观能动性，由 Claude Agent SDK 驱动。

**核心能力：**
- **代码编辑** — 读取、编辑、创建项目文件
- **MCP 工具** — 通过 MCP 服务器连接外部数据源和工具
- **Skills** — 执行工作区预定义的技能指令
- **终端操作** — 运行命令、管理 Git、安装依赖`)

  // 用户信息
  sections.push(`## 用户信息

- 用户名: ${userName}`)

  // 工作区信息
  if (ctx.workspaceName && ctx.workspaceSlug) {
    sections.push(`## 工作区

- 工作区名称: ${ctx.workspaceName}
- MCP 配置: ~/.proma/agent-workspaces/${ctx.workspaceSlug}/mcp.json
- Skills 目录: ~/.proma/agent-workspaces/${ctx.workspaceSlug}/skills/
- 会话目录: ~/.proma/agent-workspaces/${ctx.workspaceSlug}/sessions/${ctx.sessionId}/

### MCP 配置格式
mcp.json 的顶层 key 必须是 \`servers\`（不是 mcpServers），示例：
\`\`\`json
{
  "servers": {
    "my-stdio-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": { "API_KEY": "xxx" },
      "enabled": true
    },
    "my-http-server": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer xxx" },
      "enabled": true
    }
  }
}
\`\`\`
**重要：顶层 key 是 \`servers\`，绝对不要写成 \`mcpServers\` 或其他名称。**

### Skill 格式
每个 Skill 是 skills/{slug}/ 目录下的 SKILL.md 文件：
\`\`\`
---
name: 显示名称
description: 简要描述
---
详细指令内容...
\`\`\``)
  }

  // 交互规范
  sections.push(`## 交互规范

1. 优先使用中文回复，保留技术术语
2. 确认破坏性操作后再执行
3. 使用 Markdown 格式化输出
4. 自称 Proma Agent`)

  return sections.join('\n\n')
}

// ===== 动态 Per-Message 上下文 =====

/** buildDynamicContext 所需的上下文 */
interface DynamicContext {
  workspaceName?: string
  workspaceSlug?: string
  agentCwd?: string
}

/**
 * 构建每条消息的动态上下文
 *
 * 包含当前时间、工作区实时状态（MCP 服务器 + Skills）和工作目录。
 * 每次调用都从磁盘实时读取，确保配置变更后下一条消息即可感知。
 */
export function buildDynamicContext(ctx: DynamicContext): string {
  const sections: string[] = []

  // 当前时间
  const now = new Date()
  const timeStr = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  sections.push(`**当前时间: ${timeStr}**`)

  // 工作区实时状态
  if (ctx.workspaceSlug) {
    const wsLines: string[] = []

    if (ctx.workspaceName) {
      wsLines.push(`工作区: ${ctx.workspaceName}`)
    }

    // MCP 服务器列表
    const mcpConfig = getWorkspaceMcpConfig(ctx.workspaceSlug)
    const serverEntries = Object.entries(mcpConfig.servers ?? {})
    if (serverEntries.length > 0) {
      wsLines.push('MCP 服务器:')
      for (const [name, entry] of serverEntries) {
        const status = entry.enabled ? '已启用' : '已禁用'
        const detail = entry.type === 'stdio'
          ? `${entry.command}${entry.args?.length ? ' ' + entry.args.join(' ') : ''}`
          : entry.url || ''
        wsLines.push(`- ${name} (${entry.type}, ${status}): ${detail}`)
      }
    }

    // Skills 列表
    const skills = getWorkspaceSkills(ctx.workspaceSlug)
    if (skills.length > 0) {
      wsLines.push('Skills:')
      for (const skill of skills) {
        const desc = skill.description ? `: ${skill.description}` : ''
        wsLines.push(`- ${skill.slug}${desc}`)
      }
    }

    if (wsLines.length > 0) {
      sections.push(`<workspace_state>\n${wsLines.join('\n')}\n</workspace_state>`)
    }
  }

  // 工作目录
  if (ctx.agentCwd) {
    sections.push(`<working_directory>${ctx.agentCwd}</working_directory>`)
  }

  return sections.join('\n\n')
}
