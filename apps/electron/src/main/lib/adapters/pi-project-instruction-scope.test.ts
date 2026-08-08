import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectInstructions } from '../project-instruction-resolver'
import { ProjectInstructionScopeController } from './pi-project-instruction-scope'

const temporaryRoots: string[] = []

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proma-pi-scoped-instructions-'))
  temporaryRoots.push(root)
  return root
}

function createController(projectRoot: string): ProjectInstructionScopeController {
  return new ProjectInstructionScopeController({
    projectRoot,
    cwd: projectRoot,
    initialSources: resolveProjectInstructions({ projectRoot }).sources,
  })
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
  }
})

describe('Pi 项目指令动态 scope', () => {
  test('Given a nested AGENTS.md When a typed file tool first enters its subtree Then blocks once and appends the trusted instruction before retry', () => {
    const projectRoot = createProject()
    mkdirSync(join(projectRoot, 'packages', 'api'), { recursive: true })
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'root instruction')
    writeFileSync(join(projectRoot, 'packages', 'AGENTS.md'), 'packages instruction')
    const controller = createController(projectRoot)

    expect(controller.beforeToolCall({ toolName: 'read', input: { path: 'packages/api/handler.ts' } })).toEqual({
      block: true,
      reason: expect.stringContaining('激活受信任'),
    })

    const prompt = controller.appendPendingInstructions('base system prompt')
    expect(prompt).toContain('base system prompt')
    expect(prompt).toContain('packages/AGENTS.md')
    expect(prompt).toContain('packages instruction')
    expect(controller.beforeToolCall({ toolName: 'read', input: { path: 'packages/api/handler.ts' } })).toBeUndefined()
  })

  test('Given a legacy CLAUDE.md in an activated subtree When editing another project file Then requires creating AGENTS.md first', () => {
    const projectRoot = createProject()
    mkdirSync(join(projectRoot, 'apps'), { recursive: true })
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'root instruction')
    writeFileSync(join(projectRoot, 'apps', 'CLAUDE.md'), 'legacy app instruction')
    const controller = createController(projectRoot)

    expect(controller.beforeToolCall({ toolName: 'read', input: { path: 'apps/main.ts' } })?.block).toBe(true)
    const prompt = controller.appendPendingInstructions('base')
    expect(prompt).toContain('Legacy CLAUDE.md 迁移要求')
    expect(prompt).toContain('apps/CLAUDE.md')

    expect(controller.beforeToolCall({ toolName: 'write', input: { path: 'apps/main.ts' } })).toEqual({
      block: true,
      reason: expect.stringContaining('先结合当前目录实际情况创建同目录'),
    })
    expect(controller.beforeToolCall({ toolName: 'write', input: { path: 'apps/AGENTS.md' } })).toBeUndefined()
  })

  test('Given a new file target under a nested scope When writing it Then resolves the containing directory instructions', () => {
    const projectRoot = createProject()
    mkdirSync(join(projectRoot, 'packages', 'api'), { recursive: true })
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'root instruction')
    writeFileSync(join(projectRoot, 'packages', 'AGENTS.md'), 'packages instruction')
    const controller = createController(projectRoot)

    expect(controller.beforeToolCall({ toolName: 'write', input: { path: 'packages/api/new-file.ts' } })?.block).toBe(true)
    expect(controller.appendPendingInstructions('base')).toContain('packages/AGENTS.md')
  })

  test('Given no root instruction but a nested AGENTS.md When entering its subtree Then still activates that scoped instruction', () => {
    const projectRoot = createProject()
    mkdirSync(join(projectRoot, 'apps'), { recursive: true })
    writeFileSync(join(projectRoot, 'apps', 'AGENTS.md'), 'apps instruction')
    const controller = createController(projectRoot)

    expect(controller.beforeToolCall({ toolName: 'read', input: { path: 'apps/main.ts' } })?.block).toBe(true)
    expect(controller.appendPendingInstructions('base')).toContain('apps/AGENTS.md')
  })

  test('Given a path outside the project or a Bash command When observing the tool call Then does not activate a scope by guessing', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'root instruction')
    const controller = createController(projectRoot)

    expect(controller.beforeToolCall({ toolName: 'read', input: { path: '../outside.ts' } })).toBeUndefined()
    expect(controller.beforeToolCall({ toolName: 'bash', input: { command: 'cat packages/secret.ts' } })).toBeUndefined()
    expect(controller.appendPendingInstructions('base')).toBe('base')
  })
})
