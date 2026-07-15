import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
