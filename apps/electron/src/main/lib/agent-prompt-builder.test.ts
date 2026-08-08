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
  buildGitAttributionPromptSection: () => '## Git / PR 标识\n测试归因规则',
  isGitAttributionEnabled: () => true,
}))

mock.module('./settings-service', () => ({
  getSettings: () => ({ gitAttributionEnabled: true }),
}))

let buildSystemPrompt: typeof import('./agent-prompt-builder').buildSystemPrompt
let buildDynamicContext: typeof import('./agent-prompt-builder').buildDynamicContext

beforeAll(async () => {
  ({ buildSystemPrompt, buildDynamicContext } = await import('./agent-prompt-builder'))
})

function buildPrompt(overrides: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}): string {
  return buildSystemPrompt({
    workspaceName: '示例项目',
    workspaceSlug: 'sample-project',
    sessionId: 'session-1',
    agentCwd: '/tmp/sample-project',
    permissionMode: 'bypassPermissions',
    ...overrides,
  })
}

describe('Pi Agent 系统提示词', () => {
  test('Given 常规 Pi 会话 When 构建提示词 Then 保留核心行为且受长度预算约束', () => {
    const prompt = buildPrompt({
      collaborationAvailable: true,
      currentModelId: 'gpt-5.6-terra',
    })

    expect(prompt).toContain('由 Pi Agent SDK 驱动')
    expect(prompt).toContain('低风险、可验证操作直接执行')
    expect(prompt).toContain('gpt-5.6-terra')
    expect(prompt).toContain('## 协作')
    expect(prompt).toContain('TaskCreate')
    expect(prompt).not.toContain('TodoWrite')
    expect(prompt).toContain('list_todos({ status: \'open\', limit: 100 })')
    expect(prompt).toContain('list_groups({ scope: \'todo\' })')
    expect(prompt).toContain('nativeOrigin')
    expect(prompt).toContain('按需读取 Todo/日程')
    expect(prompt).toContain('已有事项只按事实更新或完成')
    expect(prompt).toContain('仅自动更新 Proma 工作区 Memory')
    expect(prompt).toContain('不写项目或会话目录的 `.claude/memory`')
    expect(prompt).toContain('## Git / PR 标识')
    expect(prompt.length).toBeLessThanOrEqual(5_000)
  })

  test('Given 未注入协作工具 When 构建提示词 Then 不宣传不可用能力', () => {
    const prompt = buildPrompt({ collaborationAvailable: false })

    expect(prompt).not.toContain('## 协作')
    expect(prompt).toContain('未提供当前模型时不自行选择其他模型')
  })

  test('Given 计划模式 When 构建提示词 Then 指向会话计划目录并要求审批', () => {
    const prompt = buildPrompt({ permissionMode: 'plan' })

    expect(prompt).toContain('## 计划模式')
    expect(prompt).toContain('/plan/')
    expect(prompt).toContain('等待用户批准')
  })

  test('Given 项目根或历史会话 cwd When 构建提示词 Then 保持项目与会话边界', () => {
    const projectPrompt = buildPrompt()
    const sessionPrompt = buildPrompt({ agentCwd: '/tmp/.proma/agent-workspaces/sample-project/session-1' })

    expect(projectPrompt).toContain('当前直接在项目根工作')
    expect(projectPrompt).toContain('Proma 工作区规则')
    expect(projectPrompt).toContain('/AGENTS.md`')
    expect(sessionPrompt).toContain('会话工作台，不等同项目根')
  })

  test('Given legacy 项目指令 When 构建提示词 Then 保留安全迁移边界', () => {
    const prompt = buildPrompt({
      legacyProjectInstructions: [{
        path: '/tmp/sample-project/CLAUDE.md',
        relativePath: 'CLAUDE.md',
        scopeRoot: '.',
        kind: 'claude',
        content: 'legacy instruction',
        contentHash: 'legacy-hash',
      }],
    })

    expect(prompt).toContain('## Legacy 项目指令迁移')
    expect(prompt).toContain('不得覆盖既有 AGENTS.md')
    expect(prompt).toContain('重命名或删除 legacy 文件')
  })
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
