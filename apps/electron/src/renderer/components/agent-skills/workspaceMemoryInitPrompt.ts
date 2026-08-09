export type MemoryHistoryRange = '1m' | '2m' | '3m' | 'all'

export const MEMORY_HISTORY_RANGE_OPTIONS: Array<{ value: MemoryHistoryRange; label: string; promptLabel: string }> = [
  { value: '1m', label: '近 1 个月', promptLabel: '最近 1 个月内' },
  { value: '2m', label: '近 2 个月', promptLabel: '最近 2 个月内' },
  { value: '3m', label: '近 3 个月', promptLabel: '最近 3 个月内' },
  { value: 'all', label: '全部', promptLabel: '全部可用历史' },
]

/** This block is project-portable policy, while exact Proma paths remain in the workspace prompt. */
export const PROJECT_KNOWLEDGE_MAINTENANCE_BLOCK = `<!-- proma:knowledge-maintenance:start -->
## 协作知识演进（Proma 维护）

- 保持本文件中的项目地图与已验证项目事实同步；命令、架构、边界和入口变化时做最小更新，不复制到协作记忆。
- Proma 工作区的 \`memory/\` 是可扩展的长期协作知识库：\`MEMORY.md\` 只做主题索引和路由，按证据创建用户画像、协作偏好、纠错与经验、决策理由等主题文件；不要把临时过程或长篇证据写入其中。
- 用户画像按具体领域渐进修订，不以“新手/专家”等全局标签定性。只有稳定、会改变未来协作判断的信息才值得维护。
- Memory 写入先提出少量候选内容并取得用户明确确认；项目地图的已验证事实可直接更新。历史会话仅在用户授权后作为分批、限量的补充证据，不得全量扫描。
<!-- proma:knowledge-maintenance:end -->`

export function getMemoryHistoryRangeLabel(value: MemoryHistoryRange): string {
  return MEMORY_HISTORY_RANGE_OPTIONS.find((option) => option.value === value)?.promptLabel ?? '最近 1 个月内'
}

/** Starts the user-authorized project-map and collaboration-profile bootstrap. */
export function buildWorkspaceKnowledgeBootstrapPrompt(): string {
  return `请开始建立当前项目的协作知识，但不要把它做成一次性“用户/项目档案”问卷。按以下顺序渐进进行。

## 第一阶段：先建立可维护的项目地图
用户已授权你主动维护系统提示中给出的两个 \`AGENTS.md\`：项目根的 \`AGENTS.md\` 与 Proma 工作区的 \`AGENTS.md\`。

1. 先读取两份现有文件（若存在），再用最小必要的项目证据核验：manifest、实际脚本、测试配置、目录入口、近期相关文档。不要只凭文件名或一般经验猜测。
2. 项目根 \`AGENTS.md\` 负责项目地图：架构、目录、命令、验证、项目边界和关键文档索引。Proma 工作区 \`AGENTS.md\` 只负责 Proma 的执行环境、工作流和指向项目根规则的入口；不要复制项目事实，也不要枚举已安装 Skills——它们会动态注入系统提示词。
3. 缺失时创建简洁的最小索引；已有时只做可验证的增量更新。优先维护已有 \`<!-- proma:... -->\` 区块；没有时只追加受管区块，绝不整体重写、删除或覆盖用户手写规则。
4. 确保项目根 \`AGENTS.md\` 包含下方完整的知识演进区块；若已有同名区块，只保留一个并按原内容做最小修订：

${PROJECT_KNOWLEDGE_MAINTENANCE_BLOCK}

5. 完成阶段后报告核验来源和更新的两份文件。无需为这两份 \`AGENTS.md\` 另行请求写入确认。

## 第二阶段：通过真实对话建立协作画像
项目地图完成后，不要读取历史会话。只在当前回复末尾提出**一个**与本次过程有关、能改善未来协作判断的简短问题，例如用户希望了解解释深度、确认方式，或在当前技术领域的熟悉度。

不要让用户笼统介绍自己或项目。“小白/专业”只能是按领域、可随新证据修订的判断，不能写成全局标签。用户回答后先复述 1–3 条候选协作信息；只有得到明确确认才能创建或更新 \`memory/user-profile.md\`，并同步创建或更新 \`MEMORY.md\` 的简短路由。用户跳过时停止追问并正常继续。

## 第三阶段：历史会话只作补证据
本次没有阅读历史会话的授权。等协作画像已有初步内容后，另行邀请用户决定是否授权分批扫描当前工作区的高信号会话。`
}

/** Builds an explicit, bounded historical-session evidence pass after profile bootstrap. */
export function buildWorkspaceSessionEvidencePrompt(historyRange: MemoryHistoryRange): string {
  const rangeLabel = getMemoryHistoryRangeLabel(historyRange)
  const rangeGuidance = historyRange === 'all'
    ? '用户明确选择全部可用历史；仍必须优先近期和高信号会话，并在得到足够证据后停止。'
    : `只处理${rangeLabel}的会话；若证据不足，不得自行扩大范围。`

  return `用户已授权你将当前项目工作区的历史会话作为**补充证据**，不是全量记忆蒸馏。协作记忆或项目地图的既有内容仍是优先上下文。

范围与预算：
- ${rangeGuidance}
- 先只查看会话元信息（时间、标题、完成状态）；选择至多 3 个近期、已完成、与当前项目直接相关的高信号会话作为第一批。
- 对每个入选会话，只读取回答问题所需的摘要或局部片段；不要读取完整原始 JSONL，不要无差别扫描，也不要为了凑数量继续消耗 tokens。
- 每批提炼后判断证据是否已经足够；足够即停止。不足时说明缺口，并由用户决定是否授权下一批。

写入边界：
- 你可以基于已核验的项目事实，小幅维护系统提示中给出的项目根或 Proma 工作区 \`AGENTS.md\`，但必须保留用户内容并遵守两份文件的职责边界。
- 对 \`memory/\` 的用户画像、偏好、纠错、经验和决策理由，只能先展示 1–3 条候选内容，再取得用户明确确认后写入。
- 不要把会话流水账、一次性任务过程或未经验证的推断写入任何长期文件；不要读取或写入其他工作区的会话或记忆。`
}
