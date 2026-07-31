import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type AgentWorkspaceManager = typeof import('./agent-workspace-manager')
type ConfigPathsModule = typeof import('./config-paths')

let manager: AgentWorkspaceManager
let configPaths: ConfigPathsModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-agent-workspace-manager-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  configPaths = await import('./config-paths')
  manager = await import('./agent-workspace-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
  mkdirSync(join(tempHome, '.proma'), { recursive: true })
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

function writeWorkspaceSkill(workspaceSlug: string, skillSlug: string, name: string): void {
  const skillDir = join(configPaths.getWorkspaceSkillsDir(workspaceSlug), skillSlug)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf-8')
}

describe('Agent 工作区 MCP 配置', () => {
  test('Given 工作区 MCP 包含内置保留名 When 归一化配置 Then 剔除冲突项并保留普通服务器', () => {
    const normalized = manager.normalizeWorkspaceMcpConfig({
      servers: {
        automation: {
          type: 'stdio',
          command: 'custom-automation',
          enabled: true,
        },
        nano_banana: {
          type: 'stdio',
          command: 'custom-nano',
          enabled: true,
        },
        github: {
          type: 'stdio',
          command: 'github-mcp',
          enabled: true,
        },
      },
    })

    expect(Object.keys(normalized.servers).sort()).toEqual(['github'])
    expect(normalized.servers.github?.command).toBe('github-mcp')
  })
})

describe('项目术语迁移', () => {
  test('Given 新安装 When 创建默认项目 Then 使用项目名称', () => {
    const workspace = manager.ensureDefaultWorkspace()

    expect(workspace.name).toBe('默认项目')
  })
})

describe('Agent 工作区创建', () => {
  test('Given 项目名称是 Windows 保留设备名 When 创建工作区 Then slug 避免直接使用保留名', () => {
    const workspace = manager.createAgentWorkspace('CON')

    expect(workspace.slug).toBe('workspace-con')
    expect(existsSync(configPaths.getAgentWorkspacePath(workspace.slug))).toBe(true)
  })

  test('Given 默认 Skill 包含 blocklist 目录 When 创建工作区 Then 初始化 Skills 时跳过高风险目录', () => {
    const defaultSkillDir = join(configPaths.getDefaultSkillsDir(), 'sample-skill')
    mkdirSync(join(defaultSkillDir, '.git', 'objects'), { recursive: true })
    mkdirSync(join(defaultSkillDir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(defaultSkillDir, 'SKILL.md'), '---\nname: Sample\n---\n', 'utf-8')
    writeFileSync(join(defaultSkillDir, '.git', 'objects', 'locked'), 'skip', 'utf-8')
    writeFileSync(join(defaultSkillDir, 'node_modules', 'pkg', 'index.js'), 'skip', 'utf-8')

    const workspace = manager.createAgentWorkspace('Filtered Copy')
    const copiedSkillDir = join(configPaths.getWorkspaceSkillsDir(workspace.slug), 'sample-skill')

    expect(existsSync(join(copiedSkillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(copiedSkillDir, '.git'))).toBe(false)
    expect(existsSync(join(copiedSkillDir, 'node_modules'))).toBe(false)
  })
})

describe('Agent 工作区 Skill 扫描', () => {
  test('Given Skills 目录包含 broken symlink When 获取工作区 Skills Then 跳过坏条目并继续扫描后续 Skill', () => {
    const workspaceSlug = 'workspace-a'
    const skillsDir = configPaths.getWorkspaceSkillsDir(workspaceSlug)

    writeWorkspaceSkill(workspaceSlug, 'alpha', 'Alpha')
    symlinkSync(join(skillsDir, 'missing-target'), join(skillsDir, 'broken-link'), 'dir')
    writeWorkspaceSkill(workspaceSlug, 'zeta', 'Zeta')

    for (let i = 0; i < 20; i++) {
      const entryNames = readdirSync(skillsDir)
      const brokenIndex = entryNames.indexOf('broken-link')
      const hasSkillAfterBroken = entryNames.slice(brokenIndex + 1).some((name) => name !== 'missing-target')
      if (brokenIndex !== -1 && hasSkillAfterBroken) break
      writeWorkspaceSkill(workspaceSlug, `tail-${i}`, `Tail ${i}`)
    }

    const finalEntryNames = readdirSync(skillsDir)
    const finalBrokenIndex = finalEntryNames.indexOf('broken-link')
    expect(finalBrokenIndex).not.toBe(-1)
    expect(finalEntryNames.slice(finalBrokenIndex + 1).some((name) => name !== 'missing-target')).toBe(true)

    const expectedSlugs = finalEntryNames
      .filter((name) => name !== 'broken-link')
      .sort()
    const skills = manager.getWorkspaceSkills(workspaceSlug)

    expect(skills.map((skill) => skill.slug).sort()).toEqual(expectedSlugs)
  })
})

describe('Agent 工作区继承配置', () => {
  test('Given 源工作区配置了 MCP/CLAUDE.md/自定义 Skill When 用 inheritFromWorkspaceId 创建新工作区 Then 复制运行时配置', () => {
    const source = manager.createAgentWorkspace('Source Workspace')
    const sourceDir = configPaths.getAgentWorkspacePath(source.slug)

    writeFileSync(
      join(sourceDir, 'mcp.json'),
      JSON.stringify({ servers: { demo: { type: 'stdio', command: 'demo-mcp', enabled: true } } }, null, 2),
      'utf-8',
    )
    writeFileSync(join(sourceDir, 'CLAUDE.md'), '# 源项目规则\n', 'utf-8')
    writeWorkspaceSkill(source.slug, 'my-custom-skill', 'My Custom')

    const target = manager.createAgentWorkspace({ name: 'Inherited Workspace', inheritFromWorkspaceId: source.id })
    const targetDir = configPaths.getAgentWorkspacePath(target.slug)

    expect(existsSync(join(targetDir, 'mcp.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(configPaths.getWorkspaceSkillsDir(target.slug), 'my-custom-skill', 'SKILL.md'))).toBe(true)
  })

  test('Given 源工作区缺少 mcp.json When 继承创建新工作区 Then 不报错并复制其余配置', () => {
    const source = manager.createAgentWorkspace('Source No Mcp')
    writeFileSync(join(configPaths.getAgentWorkspacePath(source.slug), 'CLAUDE.md'), '# 规则\n', 'utf-8')
    writeWorkspaceSkill(source.slug, 'another-custom', 'Another')

    const target = manager.createAgentWorkspace({ name: 'Inherited No Mcp', inheritFromWorkspaceId: source.id })
    const targetDir = configPaths.getAgentWorkspacePath(target.slug)

    expect(existsSync(join(targetDir, 'mcp.json'))).toBe(false)
    expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(configPaths.getWorkspaceSkillsDir(target.slug), 'another-custom', 'SKILL.md'))).toBe(true)
  })

  test('Given 继承源 id 不存在 When 创建新工作区 Then 不失败且正常初始化', () => {
    const target = manager.createAgentWorkspace({ name: 'Bad Inherit', inheritFromWorkspaceId: 'nonexistent-id' })

    expect(existsSync(configPaths.getAgentWorkspacePath(target.slug))).toBe(true)
    expect(target.slug).not.toBe('')
  })
})
