/**
 * Agent 模式推荐工具模块（Chat 模式）
 *
 * 智能识别适合 Agent 模式的任务，推荐用户切换。
 * 工具本身不执行切换，只产出推荐数据（reason + suggestedPrompt），
 * 由渲染进程的 AgentRecommendBanner 负责展示和执行迁移。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@proma/core'
import type { ChatToolMeta } from '@proma/shared'

// ===== 工具元数据 =====

export const AGENT_RECOMMEND_TOOL_META: ChatToolMeta = {
  id: 'agent-mode-recommend',
  name: 'Agent 模式推荐',
  description: '智能识别适合 Agent 模式的任务，推荐用户切换',
  params: [
    { name: 'reason', type: 'string', description: '推荐理由', required: true },
    { name: 'suggestedPrompt', type: 'string', description: '建议的 Agent 初始提示词', required: true },
  ],
  icon: 'Sparkles',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<agent_mode_recommendation>
你有能力推荐用户切换到 Agent 模式。**请积极主动地识别适合 Agent 模式的任务**，在回复用户之前先调用 suggest_agent_mode 工具。

## Agent 模式的能力

Agent 模式拥有以下 Chat 模式不具备的能力：
- **文件读写**：直接浏览、创建、编辑用户本地文件和项目代码
- **命令行操作**：执行 shell 命令、运行测试、安装依赖、构建项目
- **MCP 服务器**：连接数据库、调用外部 API、获取实时数据
- **Skills 技能**：使用专业技能完成特定任务（如创建幻灯片、分析数据、生成图表）
- **多步骤编排**：自主规划和执行复杂的多步骤任务，支持试错和迭代
- **深度研究**：通过 MCP 和 Skills 进行系统化的信息搜集、对比分析和结构化输出

## 推荐判断基准

当用户的任务符合以下**任一**场景时，就应该推荐切换：

1. **研究调研类任务**：产品调研、技术选型、竞品分析、行业报告、市场分析等需要系统化搜集和整理信息的任务
2. **内容创作与输出**：撰写长文档、报告、方案、教程等需要结构化输出的任务
3. **文件操作意图**：阅读/创建/修改代码、文档、配置文件，生成项目结构等
4. **编程开发任务**：写代码、调试、重构、添加功能、写测试等软件开发工作
5. **系统操作需求**：执行命令行操作、安装软件、运行脚本、管理进程等
6. **外部能力需求**：访问数据库、调用 API、获取实时数据、使用开发工具等
7. **数据处理分析**：数据清洗、统计分析、生成图表、制作可视化等
8. **复杂多步任务**：任何需要拆分为多个子步骤、涉及规划和迭代的任务

### 典型推荐示例

- "帮我做个 XX 产品/技术的调研" → 推荐（深度研究 + 结构化输出）
- "帮我写一个 React 组件" → 推荐（文件创建 + 代码编写）
- "分析一下这个项目的代码" → 推荐（文件读取 + 代码分析）
- "帮我整理一份报告" → 推荐（内容创作 + 结构化输出）
- "搭建一个新项目" → 推荐（文件创建 + 命令行 + 多步骤）

### 不推荐的场景

仅以下简单任务不需要推荐：简短问答、解释概念、翻译短文、日常闲聊、简单计算

## 推荐要求

- **reason 必须具体说明 Agent 模式如何帮助用户更好地实现他们的目标**。结合用户的具体任务描述 Agent 会怎样做。例如："你想做桌面端 AI 产品调研，Agent 模式可以通过 MCP 和 Skills 系统化地搜集各产品信息、自动整理对比分析，并输出结构化的调研报告文档。"
- suggestedPrompt 应概括用户的核心任务需求，作为 Agent 会话的起始提示
- 每轮对话最多推荐一次，避免反复打扰
</agent_mode_recommendation>`,
}

// ===== 工具定义（ToolDefinition 格式，传给 Provider） =====

export const AGENT_RECOMMEND_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'suggest_agent_mode',
    description: 'Proactively recommend switching to Agent mode when the task involves research, coding, file operations, command execution, content creation, data analysis, or any multi-step work. Call this before responding whenever the task would meaningfully benefit from Agent capabilities.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Specific explanation of how Agent mode can better help the user achieve their goal',
        },
        suggestedPrompt: {
          type: 'string',
          description: 'Suggested initial prompt for the Agent session, summarizing the user\'s core task',
        },
      },
      required: ['reason', 'suggestedPrompt'],
    },
  },
]

// ===== 可用性检查 =====

/**
 * Agent 推荐工具始终可用（无需外部凭据）
 */
export function isAgentRecommendAvailable(): boolean {
  return true
}

// ===== 工具执行 =====

/** 推荐工具名称集合 */
const AGENT_RECOMMEND_TOOL_NAMES = new Set(['suggest_agent_mode'])

/**
 * 判断是否为 Agent 推荐工具调用
 */
export function isAgentRecommendToolCall(toolName: string): boolean {
  return AGENT_RECOMMEND_TOOL_NAMES.has(toolName)
}

/**
 * 执行 Agent 推荐工具调用
 *
 * 返回结构化 JSON 数据，供渲染进程解析并展示推荐横幅。
 */
export async function executeAgentRecommendTool(toolCall: ToolCall): Promise<ToolResult> {
  const reason = toolCall.arguments.reason as string | undefined
  const suggestedPrompt = toolCall.arguments.suggestedPrompt as string | undefined

  if (!reason || !suggestedPrompt) {
    return {
      toolCallId: toolCall.id,
      content: '参数缺失: reason 和 suggestedPrompt 均为必填',
      isError: true,
    }
  }

  return {
    toolCallId: toolCall.id,
    content: JSON.stringify({
      type: 'agent_recommendation',
      reason,
      suggestedPrompt,
    }),
  }
}
