import { describe, expect, test } from 'bun:test'
import { buildLegacyProjectMigrationPrompt } from './project-instruction-migration'
import type { ProjectInstructionSource } from './project-instruction-resolver'

function source(kind: ProjectInstructionSource['kind'], relativePath: string, scopeRoot = '.'): ProjectInstructionSource {
  return {
    path: `/project/${relativePath}`,
    relativePath,
    scopeRoot,
    kind,
    content: '# instructions\n',
    contentHash: `${kind}-${relativePath}`,
  }
}

describe('legacy 项目指令迁移提示词', () => {
  test('Given legacy CLAUDE.md and active AGENTS.md When building the migration prompt Then requires evidence-driven scoped migration', () => {
    const prompt = buildLegacyProjectMigrationPrompt({
      sources: [
        source('agents', 'AGENTS.md'),
        source('claude', 'packages/api/CLAUDE.md', 'packages/api'),
      ],
    })

    expect(prompt).toContain('## Legacy 项目指令迁移任务')
    expect(prompt).toContain('`packages/api/CLAUDE.md`')
    expect(prompt).toContain('`AGENTS.md`')
    expect(prompt).toContain('先用 `Read` 阅读该 `CLAUDE.md` 原文')
    expect(prompt).toContain('实际项目证据')
    expect(prompt).toContain('根 `AGENTS.md` 放全项目通用规则；子目录 `AGENTS.md` 只放该子树的增量规则')
    expect(prompt).toContain('不得重命名或删除')
  })

  test('Given no legacy CLAUDE.md When building the migration prompt Then does not inject migration work', () => {
    expect(buildLegacyProjectMigrationPrompt({
      sources: [source('agents', 'AGENTS.md')],
    })).toBeUndefined()
  })
})
