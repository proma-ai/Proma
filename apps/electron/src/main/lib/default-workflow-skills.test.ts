import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeLegacyBuiltinWorkflowSkillDir } from './config-paths'

const DEFAULT_SKILLS_DIR = join(import.meta.dir, '../../../default-skills')

function readSkill(slug: string): string {
  return readFileSync(join(DEFAULT_SKILLS_DIR, slug, 'SKILL.md'), 'utf-8')
}

describe('default workflow skills', () => {
  test('ships deep research as a Proma built-in slash-command skill', () => {
    const skill = readSkill('deep-research')

    expect(skill).toContain('name: /deep-research')
    expect(skill).toContain('group: proma')
    expect(skill).toContain('version: "1.0.0"')
    expect(skill).toContain('/deep-research <question>')
    expect(skill).toContain('WebSearch')
    expect(skill).toContain('cited report')
  })

  test('ships ultracode as a Proma built-in slash-command skill', () => {
    const skill = readSkill('ultracode')

    expect(skill).toContain('name: /ultracode')
    expect(skill).toContain('group: proma')
    expect(skill).toContain('version: "1.0.0"')
    expect(skill).toContain('/ultracode <task>')
    expect(skill).toContain('Claude Code')
    expect(skill).toContain('dynamic workflow')
    expect(skill).toContain('same Agent conversation')
  })

  test('does not ship the old workflow slash skill alias', () => {
    expect(existsSync(join(DEFAULT_SKILLS_DIR, 'workflow', 'SKILL.md'))).toBe(false)
  })

  test('removes only the retired Proma workflow built-in skill', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-workflow-skill-'))
    const legacyDir = join(root, 'workflow')
    const userDir = join(root, 'user-workflow')

    try {
      mkdirSync(legacyDir)
      mkdirSync(userDir)
      writeFileSync(join(legacyDir, 'SKILL.md'), [
        '---',
        'name: /workflow',
        'group: proma',
        'version: "1.0.0"',
        '---',
        '',
        '# Old built-in',
      ].join('\n'))
      writeFileSync(join(userDir, 'SKILL.md'), [
        '---',
        'name: workflow',
        'group: user',
        'version: "1.0.0"',
        '---',
        '',
        '# User skill',
      ].join('\n'))

      expect(removeLegacyBuiltinWorkflowSkillDir(legacyDir)).toBe(true)
      expect(existsSync(legacyDir)).toBe(false)
      expect(removeLegacyBuiltinWorkflowSkillDir(userDir)).toBe(false)
      expect(existsSync(userDir)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
