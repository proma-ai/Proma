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
