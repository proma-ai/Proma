import { beforeAll, describe, expect, mock, test } from 'bun:test'

mock.module('./user-profile-service', () => ({
  getUserProfile: () => ({ userName: '测试用户' }),
}))

mock.module('./agent-workspace-manager', () => ({
  getAgentWorkspaceBySlug: () => undefined,
  getProjectFilesPath: () => '/tmp/sample-project',
  getWorkspaceMcpConfig: () => ({ servers: {} }),
}))

mock.module('./config-paths', () => ({
  getConfigDirName: () => '.proma',
}))

mock.module('./agent-git-attribution', () => ({
  buildGitAttributionPromptSection: () => '',
  isGitAttributionEnabled: () => false,
}))

mock.module('./settings-service', () => ({
  getSettings: () => ({ gitAttributionEnabled: false }),
}))

let buildSystemPrompt: typeof import('./agent-prompt-builder').buildSystemPrompt
let buildDynamicContext: typeof import('./agent-prompt-builder').buildDynamicContext

beforeAll(async () => {
  ({ buildSystemPrompt, buildDynamicContext } = await import('./agent-prompt-builder'))
})

function buildPrompt(agentCwd: string): string {
  return buildSystemPrompt({
    workspaceName: '示例项目',
    workspaceSlug: 'sample-project',
    sessionId: 'session-1',
    agentCwd,
    permissionMode: 'bypassPermissions',
    productivityTools: { todosEnabled: true, calendarEnabled: true, obsidianEnabled: true },
  })
}

describe('项目与会话工作台提示词', () => {
  test('Given 项目根 cwd When 构建提示词 Then 标明会话直接在项目中工作', () => {
    const prompt = buildPrompt('/tmp/sample-project')

    expect(prompt).toContain('## 工作区与 Context')
    expect(prompt).toContain('项目根：`/tmp/sample-project`')
    expect(prompt).toContain('当前直接在项目根工作')
    expect(prompt).toContain('AGENTS.md')
    expect(prompt).not.toContain('项目根始终是 cwd')
  })

  test('Given 历史会话工作台 cwd When 构建提示词 Then 不将它误称为项目根', () => {
    const prompt = buildPrompt('/tmp/.proma/agent-workspaces/sample-project/session-1')

    expect(prompt).toContain('会话工作台，不等同项目根')
    expect(prompt).toContain('项目根：`/tmp/sample-project`')
  })

  test('Given a root legacy CLAUDE.md When building the Pi prompt Then requires an AGENTS.md migration first', () => {
    const prompt = buildSystemPrompt({
      workspaceName: '示例项目',
      workspaceSlug: 'sample-project',
      sessionId: 'session-1',
      agentCwd: '/tmp/sample-project',
      permissionMode: 'bypassPermissions',
    productivityTools: { todosEnabled: true, calendarEnabled: true, obsidianEnabled: true },
      projectInstructions: {
        projectRoot: '/tmp/sample-project',
        sources: [{
          path: '/tmp/sample-project/CLAUDE.md',
          relativePath: 'CLAUDE.md',
          scopeRoot: '.',
          kind: 'claude',
          content: 'legacy instruction',
          contentHash: 'legacy-hash',
        }],
        diagnostics: [],
        totalBytes: 18,
      },
    })

    expect(prompt).toContain('## Legacy 项目指令迁移任务')
    expect(prompt).toContain('CLAUDE.md')
    expect(prompt).toContain('在修改对应 scope 内的其他项目文件前')
  })

  test('Given 项目动态上下文 When 构建消息前缀 Then 使用项目标签', () => {
    const context = buildDynamicContext({
      workspaceName: '示例项目',
      workspaceSlug: 'sample-project',
      agentCwd: '/tmp/sample-project',
    })

    expect(context).toContain('项目: 示例项目')
    expect(context).not.toContain('工作区: 示例项目')
  })
})

test('Given Proma 工作区 When 构建提示词 Then 指向受管 AGENTS.md 而非旧规则文件', () => {
  const prompt = buildPrompt('/tmp/sample-project')

  expect(prompt).toContain('Proma 工作区规则')
  expect(prompt).toContain('/AGENTS.md')
  expect(prompt).not.toContain('Proma 工作区 CLAUDE.md')
})

test('Given 商业版 Agent When 构建提示词 Then 明确要求为视觉增益任务主动使用 GPT Image 2', () => {
  const prompt = buildPrompt('/tmp/sample-project')

  expect(prompt).toContain('## 商业版视觉表达')
  expect(prompt).toContain('GPT Image 2 是 Proma 商业版的默认视觉能力')
  expect(prompt).toContain('设计、品牌、产品、空间、服装、营销、提案、课程、故事、内容策划或概念解释')
  expect(prompt).toContain('无需先抽象地询问“是否需要配图”')
  expect(prompt).toContain('精确数据图表和需要可编辑节点的流程图、架构图、关系图使用图表、Mermaid 或画板')
})

test('Given 新会话 workbench root 布局 When 构建提示词 Then 不再使用 legacy .context 路径', () => {
  const prompt = buildSystemPrompt({
    workspaceName: '示例项目',
    workspaceSlug: 'sample-project',
    sessionId: 'session-1',
    agentCwd: '/tmp/sample-project',
    sessionWorkbenchLayout: 'root',
    permissionMode: 'bypassPermissions',
    productivityTools: { todosEnabled: true, calendarEnabled: true, obsidianEnabled: true },
  })

  expect(prompt).toContain('/session-1`，用于本次任务')
  expect(prompt).not.toContain('/session-1/.context')
})
