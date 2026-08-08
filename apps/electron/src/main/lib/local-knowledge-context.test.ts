import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLocalKnowledgeContext } from './local-knowledge-context'

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'proma-local-recall-'))
  roots.push(root)
  const workspaceRoot = join(root, 'workspace')
  const autoMemoryDir = join(workspaceRoot, '.claude', 'memory')
  const sessionWorkbenchDir = join(workspaceRoot, 'session-1')
  const projectRoot = join(root, 'project')
  const projectContextDir = join(projectRoot, '.context')
  mkdirSync(autoMemoryDir, { recursive: true })
  mkdirSync(sessionWorkbenchDir, { recursive: true })
  mkdirSync(projectContextDir, { recursive: true })
  return { workspaceRoot, autoMemoryDir, sessionWorkbenchDir, projectRoot, projectContextDir }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('本地知识主动召回', () => {
  test('Given a memory index and a matching detail When building recall Then includes only bounded relevant references', () => {
    const paths = fixture()
    writeFileSync(join(paths.autoMemoryDir, 'MEMORY.md'), '# Memory\n- release workflow: see release.md\n')
    writeFileSync(join(paths.autoMemoryDir, 'release.md'), '# 发布流程\n发布前运行 typecheck，然后准备 release notes。')
    writeFileSync(join(paths.projectContextDir, 'release-checklist.md'), '# 发布检查清单\n运行 typecheck 并检查 release notes。')
    writeFileSync(join(paths.projectContextDir, 'unrelated.md'), '# 家庭菜单\n番茄和意面。')

    const recall = buildLocalKnowledgeContext({ userMessage: '帮我整理发布前的 release notes', paths })

    expect(recall).toContain('<local_recall>')
    expect(recall).toContain('MEMORY.md')
    expect(recall).toContain('release.md')
    expect(recall).toContain('release-checklist.md')
    expect(recall).not.toContain('家庭菜单')
    expect(recall.length).toBeLessThanOrEqual(12_500)
  })

  test('Given an unrelated short message When building recall Then does not inject project Context noise', () => {
    const paths = fixture()
    writeFileSync(join(paths.projectContextDir, 'research.md'), '# 研究\n这段资料不该出现在无关问候中。')

    expect(buildLocalKnowledgeContext({ userMessage: '嗨', paths })).toBe('')
  })

  test('Given a continuation request When building recall Then includes handoff and todo from the current workbench', () => {
    const paths = fixture()
    writeFileSync(join(paths.sessionWorkbenchDir, 'handoff.md'), '# Handoff\n修复发布流程的剩余测试。')
    writeFileSync(join(paths.sessionWorkbenchDir, 'todo.md'), '# Todo\n- 运行 typecheck')

    const recall = buildLocalKnowledgeContext({ userMessage: '继续上次的进度', paths })

    expect(recall).toContain('Handoff')
    expect(recall).toContain('运行 typecheck')
  })

  test('Given a symlink escaping an approved root When building recall Then ignores that content', () => {
    const paths = fixture()
    const external = join(paths.projectRoot, '..', 'outside.md')
    writeFileSync(external, '# 外部资料\n绝不能被读取')
    symlinkSync(external, join(paths.projectContextDir, 'escaped.md'))

    const recall = buildLocalKnowledgeContext({ userMessage: '外部资料', paths })

    expect(recall).not.toContain('绝不能被读取')
  })
})
