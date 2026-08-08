import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectInstructions } from './project-instruction-resolver'

const temporaryRoots: string[] = []

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proma-project-instructions-'))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
  }
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
