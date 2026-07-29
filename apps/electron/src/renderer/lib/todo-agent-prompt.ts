/**
 * Todo 的详情不复制进首条消息；Pi Agent 必须通过 Planning MCP 读取数据层中的原始最新记录。
 * 非 Pi runtime 没有对应 MCP，仍会从 orchestrator 注入的 referenced_planning 快照取得同一记录。
 */
export function buildTodoAgentPrompt(todoId: string, supportsPlanningMcp: boolean): string {
  const sourceInstruction = supportsPlanningMcp
    ? `开始前必须调用 \`mcp__planning__get_todo({ id: "${todoId}" })\`，读取此 Todo 的原始最新信息（标题、说明、优先级、计划完成时间及关联上下文）。`
    : '开始前请先读取系统注入的 referenced_planning 原始 Todo 快照。'

  return [
    `请处理关联的 Todo（ID: ${todoId}）。`,
    '',
    sourceInstruction,
    '随后检查当前项目状态，并根据任务目标推进工作；需要澄清或遇到高风险操作时先询问用户。不要把 Todo 标记为完成，除非工作确实完成或用户明确要求。',
  ].join('\n')
}
