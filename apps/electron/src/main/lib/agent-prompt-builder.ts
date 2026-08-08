/**
 * Pi Agent 系统提示词与动态上下文构建器。
 * 静态提示词只保留 Proma 独有、且未由运行时或工具 schema 强制的行为契约。
 */

import type { PromaPermissionMode, SessionWorkbenchLayout } from '@proma/shared'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { getUserProfile } from './user-profile-service'
import { getAgentWorkspaceBySlug, getProjectFilesPath, getWorkspaceMcpConfig } from './agent-workspace-manager'
import { getConfigDirName } from './config-paths'
import { buildGitAttributionPromptSection, isGitAttributionEnabled } from './agent-git-attribution'
import { getSettings } from './settings-service'
import type { ProjectInstructionSource } from './project-instruction-resolver'
import { buildLegacyProjectMigrationPrompt as buildLegacyProjectMigrationRequirement } from './project-instruction-migration'

const WORKFLOW_PROMPT = `## 工作流
- 需要多个步骤、多个文件或并行/委派时，先用 TaskCreate 建立 3–7 个可见进度项；仅用 TaskUpdate 追加更新，完成后收束状态。
- 回复中的 fenced code block 必须声明语言；未知文本用 \`text\`。`

interface SystemPromptContext {
  workspaceName?: string
  workspaceSlug?: string
  sessionId: string
  agentCwd?: string
  /** 会话私有工作台布局；缺失时按历史 `.context/` 兼容。 */
  sessionWorkbenchLayout?: SessionWorkbenchLayout
  permissionMode: PromaPermissionMode
  collaborationAvailable?: boolean
  currentModelId?: string
  legacyProjectInstructions?: ProjectInstructionSource[]
}

function buildWorkspacePaths(
  workspaceSlug: string,
  sessionId: string,
  agentCwd?: string,
  sessionWorkbenchLayout: SessionWorkbenchLayout = 'legacy-context',
) {
  const configDirName = getConfigDirName()
  const workspaceRoot = join(homedir(), configDirName, 'agent-workspaces', workspaceSlug)
  const sessionDir = join(workspaceRoot, sessionId)
  const projectRoot = getProjectFilesPath(workspaceSlug)
  const effectiveAgentCwd = agentCwd ?? projectRoot

  return {
    workspaceRoot,
    projectRoot,
    sessionDir,
    sessionContextDir: sessionWorkbenchLayout === 'root' ? sessionDir : join(sessionDir, '.context'),
    sessionWorkbenchLayout,
    workspaceContextDir: join(projectRoot, '.context'),
    agentCwd: effectiveAgentCwd,
    isProjectCwd: resolve(effectiveAgentCwd) === resolve(projectRoot),
    isLocalProject: Boolean(getAgentWorkspaceBySlug(workspaceSlug)?.projectRootPath),
    agentsMd: join(workspaceRoot, 'AGENTS.md'),
    autoMemoryIndex: join(workspaceRoot, '.claude', 'memory', 'MEMORY.md'),
    mcpConfig: join(workspaceRoot, 'mcp.json'),
    skillsDir: join(workspaceRoot, 'skills'),
  }
}

/** 构建 Pi Agent 的静态系统提示词。 */
export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const userName = getUserProfile().userName || '用户'
  const workspace = ctx.workspaceSlug
    ? buildWorkspacePaths(ctx.workspaceSlug, ctx.sessionId, ctx.agentCwd, ctx.sessionWorkbenchLayout)
    : undefined
  const sessionContextDir = workspace?.sessionContextDir ?? '.context'
  const projectContextDir = workspace?.workspaceContextDir ?? '.context'
  const modelRule = ctx.currentModelId?.trim()
    ? `委派默认复用当前模型 \`${ctx.currentModelId.trim()}\`；用户指定其他模型时，先查询可用模型。`
    : '未提供当前模型时不自行选择其他模型。'

  const sections = [
    `# Proma Agent
你是由 Pi Agent SDK 驱动的 Proma Agent，协助用户 ${userName}。优先中文，直接解决明确目标；低风险、可验证操作直接执行。涉及不可逆删除、外部发送/发布、付费或安全边界变化时先确认。`,
    `## Pi 运行时
使用 Proma 提供的工具；Write 必须同时传入完整 \`path\` 与 \`content\`。附加目录可用其绝对路径访问。${modelRule}`,
    WORKFLOW_PROMPT,
    `## 任务、日程与自动化
明确且用户认可的后续行动用 Todo；有明确开始时间的安排用日程；提醒必须有具体时点。创建 Todo 前必须调用 \`list_todos({ status: 'open', limit: 100 })\` 与 \`list_groups({ scope: 'todo' })\` 去重/复用；外部来源（\`nativeOrigin\`）的修改、完成或删除先说明副作用并确认。规划、承诺交付、询问近期安排或结束含行动项的对话时，按需读取 Todo/日程；已有事项只按事实更新或完成，取消不删除。持续或延迟的无人值守工作先读取 \`automation\` Skill；纯提醒不创建 Automation。具体参数和权限遵循工具说明。`,
    ctx.collaborationAvailable
      ? '## 协作\n独立并行探索或对抗审查才使用 \`collaboration\`；先建可见进度项，委派说明保持自包含，收敛结果后更新父任务。子会话不得继续委派。'
      : undefined,
    workspace
      ? `## 工作区与 Context
- 项目根：\`${workspace.projectRoot}\`（${workspace.isLocalProject ? '用户本地原始文件' : 'Proma 托管项目文件'}）；cwd：\`${workspace.agentCwd}\`（${workspace.isProjectCwd ? '当前直接在项目根工作' : '会话工作台，不等同项目根'}）。
- 会话工作台：\`${sessionContextDir}\`，用于本次任务、计划和交接；新会话直接使用 workbench 根，历史会话兼容 \`.context/\`。项目级 Context：\`${projectContextDir}\` 用于跨会话资料。用户指定位置优先；不要随意清理本地项目。
- Proma 工作区规则：\`${workspace.agentsMd}\`；记忆索引：\`${workspace.autoMemoryIndex}\`；MCP：\`${workspace.mcpConfig}\`；Skills：\`${workspace.skillsDir}\`。只使用 Proma 工作区的 MCP/Skills 配置。
- 需要原文或更多细节时，再按当前任务读取两级 Context、记忆索引或 Skill 元数据；禁止无差别全量扫描。`
      : undefined,
    buildLegacyProjectMigrationRequirement({ sources: ctx.legacyProjectInstructions ?? [] }),
    `## 知识维护
Proma 工作区 AGENTS 记录稳定工作区规则；用户项目 AGENTS 记录经验证的跨 Agent 项目规则；Memory 保存稳定偏好、决策和经验；Skill 保存重复 SOP；Context 保存任务资料。只做小幅、基于证据的更新；不要把临时过程、未验证推断或长正文写入 AGENTS/Memory。仅自动更新 Proma 工作区 Memory，不写项目或会话目录的 \`.claude/memory\`。`,
    ctx.permissionMode === 'plan'
      ? `## 计划模式
只调研和规划。计划写入 \`${sessionContextDir}/plan/\`；先展示摘要并等待用户批准，再退出计划模式和执行。`
      : `## 计划模式
进入计划模式时，计划文件写入 \`${sessionContextDir}/plan/\`（如 \`${sessionContextDir}/plan/my-plan.md\`），不要写到项目根。`,
    buildGitAttributionPromptSection(isGitAttributionEnabled(getSettings().gitAttributionEnabled)),
    '## 回复\n日常回复简洁直接；文本交付物需要完整时再展开。复杂任务中定期核对相关规则、记忆、Skills 与 Context。',
  ]

  return sections.filter((section): section is string => Boolean(section)).join('\n\n')
}

// ===== 动态 Per-Message 上下文 =====

interface DynamicContext {
  workspaceName?: string
  workspaceSlug?: string
  agentCwd?: string
}

/** 每条用户消息的实时环境信息。 */
export function buildDynamicContext(ctx: DynamicContext): string {
  const sections: string[] = []
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

  if (ctx.workspaceSlug) {
    const workspaceLines: string[] = []
    if (ctx.workspaceName) workspaceLines.push(`项目: ${ctx.workspaceName}`)

    const servers = Object.entries(getWorkspaceMcpConfig(ctx.workspaceSlug).servers ?? {})
    if (servers.length > 0) {
      workspaceLines.push('MCP 服务器:')
      for (const [name, entry] of servers) {
        const status = entry.enabled ? '已启用' : '已禁用'
        const detail = entry.type === 'stdio'
          ? `${entry.command}${entry.args?.length ? ` ${entry.args.join(' ')}` : ''}`
          : entry.url || ''
        workspaceLines.push(`- ${name} (${entry.type}, ${status}): ${detail}`)
      }
    }

    if (workspaceLines.length > 0) {
      sections.push(`<workspace_state>\n${workspaceLines.join('\n')}\n</workspace_state>`)
    }
  }

  if (ctx.agentCwd) sections.push(`<working_directory>${ctx.agentCwd}</working_directory>`)
  return sections.join('\n\n')
}
