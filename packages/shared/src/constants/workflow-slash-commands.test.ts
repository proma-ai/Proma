import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_WORKFLOW_SLASH_COMMANDS,
  buildBuiltinWorkflowSlashCommandPrompt,
  getBuiltinWorkflowSlashCommandBySlug,
  isBuiltinWorkflowSlashCommandMessage,
  isBuiltinWorkflowSlashCommandSlug,
  isLegacyBuiltinWorkflowSkillSlug,
  parseBuiltinWorkflowSlashCommandMessage,
} from './workflow-slash-commands'

describe('built-in workflow slash commands', () => {
  test('declares deep research and ultracode as exact slash commands', () => {
    expect(BUILTIN_WORKFLOW_SLASH_COMMANDS.map((command) => command.command)).toEqual([
      '/deep-research',
      '/ultracode',
    ])
    expect(BUILTIN_WORKFLOW_SLASH_COMMANDS.every((command) => command.name === command.command)).toBe(true)
  })

  test('maps skill slugs to native slash commands', () => {
    expect(getBuiltinWorkflowSlashCommandBySlug('deep-research')?.command).toBe('/deep-research')
    expect(getBuiltinWorkflowSlashCommandBySlug('ultracode')?.command).toBe('/ultracode')
    expect(isBuiltinWorkflowSlashCommandSlug('automation')).toBe(false)
  })

  test('parses only supported leading workflow slash commands', () => {
    expect(parseBuiltinWorkflowSlashCommandMessage('/deep-research What changed?')?.slug).toBe('deep-research')
    expect(parseBuiltinWorkflowSlashCommandMessage('  /ultracode audit src/routes')?.slug).toBe('ultracode')
    expect(isBuiltinWorkflowSlashCommandMessage('/workflow audit src/routes')).toBe(false)
    expect(isBuiltinWorkflowSlashCommandMessage('/workflows')).toBe(false)
    expect(isBuiltinWorkflowSlashCommandMessage('please run /deep-research later')).toBe(false)
  })

  test('preserves bundled deep research and rewrites ultracode slash command to keyword opt-in', () => {
    expect(buildBuiltinWorkflowSlashCommandPrompt('  /deep-research What changed?')).toBe('/deep-research What changed?')
    expect(buildBuiltinWorkflowSlashCommandPrompt('/ultracode audit src/routes')).toBe('ultracode: audit src/routes')
    expect(buildBuiltinWorkflowSlashCommandPrompt('/automation daily summary')).toBe('/automation daily summary')
  })

  test('flags the old Proma workflow skill slug as a hidden legacy alias', () => {
    expect(isLegacyBuiltinWorkflowSkillSlug('workflow')).toBe(true)
    expect(isLegacyBuiltinWorkflowSkillSlug('ultracode')).toBe(false)
  })
})
