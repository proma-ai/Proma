import type { ProjectInstructionSource } from './project-instruction-resolver'

interface LegacyMigrationPromptOptions {
  sources: ProjectInstructionSource[]
  headingLevel?: 2 | 3
}

function formatSourceEntry(source: ProjectInstructionSource): string {
  return `- \`${source.relativePath}\`（scope: \`${source.scopeRoot}\`，hash: \`${source.contentHash}\`）`
}

/**
 * 生成 legacy CLAUDE.md → AGENTS.md 的迁移要求。
 *
 * 指令解析器已经保证每个目录至多激活一个候选文件；因此传入的 legacy
 * source 均表示该目录当前没有优先级更高的 AGENTS.md。
 */
export function buildLegacyProjectMigrationPrompt(options: LegacyMigrationPromptOptions): string | undefined {
  const legacySources = options.sources.filter((source) => source.kind === 'claude')
  if (legacySources.length === 0) return undefined

  const activeAgents = options.sources.filter((source) => source.kind === 'agents')
  const activeAgentsSection = activeAgents.length > 0
    ? `\n\n本轮已激活、可能对迁移 scope 生效的 \`AGENTS.md\`：\n${activeAgents.map(formatSourceEntry).join('\n')}`
    : ''
  const heading = '#'.repeat(options.headingLevel ?? 2)

  return `${heading} Legacy 项目指令迁移任务

Proma 已从受信任项目根加载以下 legacy \`CLAUDE.md\` 兼容来源；每一项都需要迁移到**同目录**的 \`AGENTS.md\`：\n${legacySources.map(formatSourceEntry).join('\n')}${activeAgentsSection}

在修改对应 scope 内的其他项目文件前，逐个完成以下证据驱动的迁移：

1. **读取与核验**：先用 \`Read\` 阅读该 \`CLAUDE.md\` 原文；再读取已激活的父级 \`AGENTS.md\`、同目录刚出现的 \`AGENTS.md\`（若有），并用最小必要的 \`LS\` / \`Read\` 检查该 scope 的实际项目证据，例如 manifest、现有脚本、测试配置、目录入口和相邻文档。不要只凭文件名或旧规则猜测命令、架构和约定。
2. **提炼而非照抄**：保留 legacy 中仍可由当前项目证据支持的稳定规则、命令、架构边界、测试方式和协作流程；过时、冲突、一次性调试记录、个人偏好、密钥、长篇说明及仅适用于 Claude 的运行时措辞不得机械复制。无法核验且会实质影响工作方式的内容，先向用户说明或请求确认。
3. **按 AGENTS.md 最佳实践写入**：只写跨 Agent、跨会话有用且项目特有的内容；命令和路径必须已核验。根 \`AGENTS.md\` 放全项目通用规则；子目录 \`AGENTS.md\` 只放该子树的增量规则，引用父级规则而不重复。使用简短 Markdown 标题和可执行 bullet（常见为 Commands、Architecture、Conventions、Testing / Delivery），链接已有文档而非复制正文；避免通用模板，保持精炼、可维护。
4. **安全写入与报告**：只创建或最小增量修改目标 \`AGENTS.md\`，不整体覆盖已有内容；保留 \`CLAUDE.md\`，不得重命名或删除。完成后简短报告：读取的证据、保留/舍弃或待确认的规则、以及写入的 scope。

若项目现状与 legacy 规则冲突，以可验证的当前项目事实和更近 scope 的 \`AGENTS.md\` 为准；不要编造折中结论。`
}
