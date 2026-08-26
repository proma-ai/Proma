import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasRootProjectAgentsInstruction, resolveProjectInstructions } from './project-instruction-resolver'

const temporaryProjects: string[] = []

function createProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'proma-project-instructions-'))
  temporaryProjects.push(projectRoot)
  return projectRoot
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true })
  }
})

describe('项目根 AGENTS 指令状态', () => {
  test('Given Linux 大小写不同的 AGENTS.MD When 解析项目指令 Then 标记项目地图已建立', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'AGENTS.MD'), '# Project instructions')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toHaveLength(1)
    expect(manifest.sources[0]).toMatchObject({ kind: 'agents', scopeRoot: '.' })
    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })

  test('Given 项目内 AGENTS.md 符号链接 When 解析项目指令 Then 标记项目地图已建立', () => {
    const projectRoot = createProject()
    const instructionsDirectory = join(projectRoot, 'instructions')
    mkdirSync(instructionsDirectory)
    writeFileSync(join(instructionsDirectory, 'project.md'), '# Project instructions')
    symlinkSync(join('instructions', 'project.md'), join(projectRoot, 'AGENTS.md'))

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toHaveLength(1)
    expect(manifest.sources[0]).toMatchObject({ kind: 'agents', relativePath: 'AGENTS.md', scopeRoot: '.' })
    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })

  test('Given 仅有 legacy CLAUDE.md When 解析项目指令 Then 项目地图仍标记未建立', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Legacy instructions')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(hasRootProjectAgentsInstruction(manifest)).toBe(false)
  })

  test('Given 未创建的目标文件位于项目根内 When 解析项目指令 Then 仍保留根指令状态', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'AGENTS.md'), '# Project instructions')

    const manifest = resolveProjectInstructions({
      projectRoot,
      targetPath: join(projectRoot, 'new-directory', 'new-file.ts'),
    })

    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })
})

describe('项目指令解析器', () => {
  test('Given AGENTS.md and CLAUDE.md in one directory When resolving Then AGENTS.md wins', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'shared project instructions')
    writeFileSync(join(projectRoot, 'CLAUDE.md'), 'legacy instructions that must not be combined')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toEqual([
      expect.objectContaining({
        relativePath: 'AGENTS.md',
        scopeRoot: '.',
        kind: 'agents',
        content: 'shared project instructions',
      }),
    ])
  })

  test('Given only a legacy CLAUDE.md When resolving Then preserves it as an explicit compatibility source', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'CLAUDE.md'), 'legacy claude project instructions')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toEqual([
      expect.objectContaining({ relativePath: 'CLAUDE.md', kind: 'claude' }),
    ])
  })

  test('Given nested project instructions When resolving a file Then accumulates only that file path ancestors', () => {
    const projectRoot = createProject()
    const electronDir = join(projectRoot, 'apps', 'electron')
    const packageDir = join(projectRoot, 'packages', 'shared')
    mkdirSync(electronDir, { recursive: true })
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'root instructions')
    writeFileSync(join(projectRoot, 'apps', 'AGENTS.md'), 'apps instructions')
    writeFileSync(join(electronDir, 'CLAUDE.md'), 'electron legacy instructions')
    writeFileSync(join(projectRoot, 'packages', 'AGENTS.md'), 'packages instructions')

    const manifest = resolveProjectInstructions({
      projectRoot,
      targetPath: join(electronDir, 'src', 'main.ts'),
    })

    expect(manifest.sources.map((source) => [source.relativePath, source.scopeRoot])).toEqual([
      ['AGENTS.md', '.'],
      ['apps/AGENTS.md', 'apps'],
      ['apps/electron/CLAUDE.md', 'apps/electron'],
    ])
  })

  test('Given an instruction symlink outside the project When resolving Then excludes it', () => {
    const projectRoot = createProject()
    const external = createProject()
    writeFileSync(join(external, 'AGENTS.md'), 'external instruction')
    symlinkSync(join(external, 'AGENTS.md'), join(projectRoot, 'AGENTS.md'))

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toEqual([])
    expect(manifest.diagnostics).toEqual([
      expect.objectContaining({ message: '已忽略指向项目根目录外的符号链接指令文件' }),
    ])
  })

  test('Given a target outside the authorized root When resolving Then rejects it', () => {
    const projectRoot = createProject()
    const outside = createProject()

    expect(() => resolveProjectInstructions({ projectRoot, targetPath: outside })).toThrow('已授权的项目根目录内')
  })
})
