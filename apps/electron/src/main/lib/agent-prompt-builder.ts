/**
 * Pi Agent 系统提示词与动态上下文构建器。
 * 静态提示词只保留 Proma 独有、且未由运行时或工具 schema 强制的行为契约。
 */

import type { PromaPermissionMode, SessionWorkbenchLayout } from '@proma/shared'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { getUserProfile } from './user-profile-service'
import { getAgentWorkspaceBySlug, getProjectFilesPath, getWorkspaceMcpConfig, type WorkspaceMemoryGuidance } from './agent-workspace-manager'
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
  /** Only explicit guided consent enables Agent-initiated AGENTS.md maintenance. */
  projectKnowledgeMaintenanceApproved?: boolean
  /** 每次前台运行按 Markdown 文件实际覆盖度计算；不产生第二套记忆状态。 */
  memoryGuidance?: WorkspaceMemoryGuidance
  /** 惰性周检命中时才提供；它只邀请用户复查，绝不自动读写历史。 */
  memoryRefreshOpportunity?: { memoryUpdatedAt?: number; newestSessionAt: number; newerSessionCount: number }
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
    projectAgentsMd: join(projectRoot, 'AGENTS.md'),
    autoMemoryDir: join(workspaceRoot, 'memory'),
    autoMemoryIndex: join(workspaceRoot, 'memory', 'MEMORY.md'),
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
  const canMaintainProjectKnowledge = ctx.projectKnowledgeMaintenanceApproved === true
  const agentsMaintenanceMode = canMaintainProjectKnowledge
    ? '已获明确授权：基于本轮核验过的项目证据主动创建或小幅更新'
    : '未获授权：只读取、核验并提出候选，不得由 Agent 自动写入'
  const agentsMaintenanceRequirement = canMaintainProjectKnowledge
    ? '- 项目地图优先：若项目根或 Proma 工作区的 `AGENTS.md` 缺失，或本轮已核验的项目事实证明索引已过时，在完成当前任务后主动创建或做最小更新。项目根缺少 `<!-- proma:knowledge-maintenance:start -->` 区块时，同时按知识维护 Skill 的原则追加该紧凑协议。先读取现有内容、manifest、脚本、测试配置和相关文档；不凭文件名猜测。'
    : '- 当前工作区尚未授权 Agent 主动维护两份 `AGENTS.md`。不得创建、修改或追加项目根或 workspace `AGENTS.md`；若发现缺失或过时，只说明证据与最小候选变更，并请求用户启动“同意并开始建立”引导后再写入。'

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
    `## 知识维护与访问边界
Proma 将项目地图与用户协作记忆分开维护：前者让 Agent 少做重复探索，后者让 Agent 更好地服务用户。不得把它们混为同一个档案。

| 层级 | 位置 | 维护方式 | 内容边界 |
| --- | --- | --- | --- |
| 项目地图 | \`${workspace?.projectAgentsMd ?? '项目根/AGENTS.md'}\` | ${agentsMaintenanceMode} | 架构、目录、命令、验证、项目边界与关键文档索引 |
| Proma 工作区规则 | \`${workspace?.agentsMd ?? 'AGENTS.md'}\` | ${agentsMaintenanceMode} | Proma 执行环境、工作区流程、项目入口指针；不复制项目地图 |
| 协作记忆 | \`${workspace?.autoMemoryDir ?? 'memory'}\` | 仅在用户明确确认候选内容后写入 | 用户画像、协作偏好、纠错、经验与会影响未来判断的决策理由；\`MEMORY.md\` 只作主题索引 |
| Skills | \`${workspace?.skillsDir ?? 'skills'}\` | 仅在匹配任务或用户请求时读取/维护 | 可复用流程与 SOP，不存普通事实 |
| 会话工作台 | \`${sessionContextDir}\` | 当前会话可读写 | todo、plan、handoff、临时笔记和中间产物，不自动升级为长期知识 |
| 项目 Context | \`${projectContextDir}\` | 按当前任务读取；仅在用户要求或交付跨会话资料时写入 | 长调研、设计、证据与 checklist，不作为个人偏好库 |

${agentsMaintenanceRequirement}
- 两份 \`AGENTS.md\` 的职责不得重叠。项目事实写项目根；Proma 特有规则写工作区文件并链接项目根。工作区 \`AGENTS.md\` 不得枚举已安装或可用的 Skills：它们已由系统提示词动态注入。优先维护已有 \`<!-- proma:... -->\` 受管区块；没有时只追加紧凑区块，绝不整体重写或覆盖用户手写规则。
- 长期记忆根固定为工作区 \`memory/\`，不是项目根或会话工作台的 \`.claude/memory/\`。不要读取、创建或修改后者；旧目录仅由 Proma 的安全迁移处理。
- 写入协作记忆前，先读取 \`MEMORY.md\`、\`user-profile.md\` 与相关主题文件；只写入用户明确要求记住、重复出现，或缺失后会让未来 Agent 明显犯错的稳定知识。`,
    ctx.memoryGuidance?.needsCollaborationProfile && workspace
      ? `## 协作知识状态
当前尚未建立 \`memory/user-profile.md\`。这是状态提醒，不要求你立即收集资料；仅在当前任务自然暴露出高价值协作信号时，按项目根 \`AGENTS.md\` 的知识演进约定渐进处理。`
      : undefined,
    ctx.memoryRefreshOpportunity && workspace
      ? `## 项目记忆复查邀请
距离当前工作区长期协作知识上次更新已超过内部复查间隔；期间产生了 ${ctx.memoryRefreshOpportunity.newerSessionCount} 个更新会话（**包括已归档会话**，归档不代表历史无效）。

完成当前用户请求后，使用 \`AskUserQuestion\` 简短询问用户：是否愿意授权你将上次协作记忆更新后的当前工作区会话作为补充证据。用户可选择“本周期跳过”；不要把它当作错误或继续追问。
若获得会话整理授权，先按元信息选择少量近期、高信号会话并分批读取必要片段；不要全量扫描。协作记忆写入仍须在展示候选后再次取得确认；绝不跨工作区扫描。`
      : undefined,
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
