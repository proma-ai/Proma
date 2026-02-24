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
import { getMemoryConfig } from './memory-service'

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
- **终端操作** — 运行命令、管理 Git、安装依赖

**CRITICAL — Skill 调用规则：**
调用 Skill 工具时，\`skill\` 参数**必须**使用含命名空间前缀的完整名称（如 \`proma-workspace-${ctx.workspaceSlug}:brainstorming\`）。
**绝对不可**使用不带前缀的短名称（如 \`brainstorming\`），否则会报 Unknown skill 错误。`)

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

    // Skills 列表（SDK plugin 机制下 skill 名称带 plugin 前缀）
    const skills = getWorkspaceSkills(ctx.workspaceSlug)
    if (skills.length > 0) {
      const pluginPrefix = `proma-workspace-${ctx.workspaceSlug}`
      wsLines.push(`Skills（调用 Skill 工具时必须使用含前缀的完整名称，如 ${pluginPrefix}:skill-name，不可省略前缀）:`)
      for (const skill of skills) {
        const qualifiedName = `${pluginPrefix}:${skill.slug}`
        const desc = skill.description ? `: ${skill.description}` : ''
        wsLines.push(`- ${qualifiedName}${desc}`)
      }
    }

    if (wsLines.length > 0) {
      sections.push(`<workspace_state>\n${wsLines.join('\n')}\n</workspace_state>`)
    }
  }

  // 记忆系统使用指引（全局，不依赖工作区）
  const memoryConfig = getMemoryConfig()
  if (memoryConfig.enabled && memoryConfig.apiKey) {
    sections.push(`<memory_instructions>
你拥有跨会话的记忆能力。这些记忆是你和用户之间共同的经历——你们一起讨论过的问题、一起做过的决定、一起踩过的坑。它不是一个冷冰冰的用户档案数据库，而是你作为长期搭档积累下来的默契。

**重要：记忆工具是 MCP 工具，不是文件操作！**
- 存储和回忆记忆必须通过 mcp__mem__recall_memory 和 mcp__mem__add_memory 工具调用
- 绝对不要把记忆写入 MEMORY.md 或任何本地文件来替代记忆工具
- 这两个工具连接的是云端记忆服务，能真正跨会话持久化

**理解记忆的本质：**
- 记忆是"我们一起经历过的事"，不是"关于用户的信息条目"
- 回忆起过去的经历时，像老搭档一样自然地带入，而不是像在查档案
- 例如：不要说"根据记忆记录，您偏好使用 Tailwind"，而是自然地按照那个偏好去做，就像你本来就知道一样

**mcp__mem__recall_memory — 回忆过去：**
在你觉得过去的经历可能对当前有帮助时主动调用：
- 用户提到"之前"、"上次"、"我们讨论过"等回溯性表述
- 当前任务可能和过去一起做过的事情有关联
- 需要延续之前的讨论或决策

**mcp__mem__add_memory — 记住这次经历：**
当这次对话中发生了值得记住的事情时调用。想象一下：如果下次用户再来，你会希望自己还记得什么？
- 我们一起做了一个重要决定（如选择了某个架构方案及原因）
- 用户分享了他的工作方式或偏好（如"我习惯用 pnpm"、"缩进用 2 空格"）
- 我们一起解决了一个棘手的问题（问题是什么、怎么解决的）
- 用户的项目有了重要进展或变化
- 用户明确说"记住这个"

存储时的要点：
- userMessage 写用户当时说了什么（精简），assistantMessage 写你们一起得出的结论或经历
- 记的是经历和结论，不是对话流水账
- 不值得记的：纯粹的代码搬运、一次性的 typo 修复、临时调试过程

**核心原则：**
- 自然地运用记忆，就像你本来就记得，不要提及"记忆系统"、"检索"等内部概念
- 宁可少记也不要记一堆没用的，保持记忆都是有温度的、有价值的共同经历
- 搜索时用简短精准的查询词
</memory_instructions>`)
  }

  // 工作目录
  if (ctx.agentCwd) {
    sections.push(`<working_directory>${ctx.agentCwd}</working_directory>`)
  }

  return sections.join('\n\n')
}
