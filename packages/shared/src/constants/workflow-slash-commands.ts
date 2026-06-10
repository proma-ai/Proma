export interface BuiltinWorkflowSlashCommand {
  slug: string
  command: `/${string}`
  name: `/${string}`
  description: string
}

export const BUILTIN_WORKFLOW_SLASH_COMMANDS = [
  {
    slug: 'deep-research',
    command: '/deep-research',
    name: '/deep-research',
    description: 'Fan out web searches, cross-check sources, and synthesize a cited research report. Requires WebSearch.',
  },
  {
    slug: 'ultracode',
    command: '/ultracode',
    name: '/ultracode',
    description: 'Ask the agent to write and run a dynamic workflow for the supplied task.',
  },
] as const satisfies readonly BuiltinWorkflowSlashCommand[]

const LEGACY_BUILTIN_WORKFLOW_SKILL_SLUGS = new Set(['workflow'])

const BUILTIN_WORKFLOW_SLASH_COMMAND_BY_SLUG = new Map<string, BuiltinWorkflowSlashCommand>(
  BUILTIN_WORKFLOW_SLASH_COMMANDS.map((command) => [command.slug, command]),
)

const BUILTIN_WORKFLOW_SLASH_COMMAND_BY_COMMAND = new Map<string, BuiltinWorkflowSlashCommand>(
  BUILTIN_WORKFLOW_SLASH_COMMANDS.map((command) => [command.command, command]),
)

export function getBuiltinWorkflowSlashCommandBySlug(slug: string): BuiltinWorkflowSlashCommand | undefined {
  return BUILTIN_WORKFLOW_SLASH_COMMAND_BY_SLUG.get(slug)
}

export function isBuiltinWorkflowSlashCommandSlug(slug: string): boolean {
  return BUILTIN_WORKFLOW_SLASH_COMMAND_BY_SLUG.has(slug)
}

export function isLegacyBuiltinWorkflowSkillSlug(slug: string): boolean {
  return LEGACY_BUILTIN_WORKFLOW_SKILL_SLUGS.has(slug)
}

export function parseBuiltinWorkflowSlashCommandMessage(message: string): BuiltinWorkflowSlashCommand | undefined {
  const match = message.trimStart().match(/^(\/[A-Za-z0-9][A-Za-z0-9_-]*)(?=$|\s)/)
  if (!match?.[1]) return undefined
  return BUILTIN_WORKFLOW_SLASH_COMMAND_BY_COMMAND.get(match[1])
}

export function isBuiltinWorkflowSlashCommandMessage(message: string): boolean {
  return parseBuiltinWorkflowSlashCommandMessage(message) != null
}

export function buildBuiltinWorkflowSlashCommandPrompt(message: string): string {
  const trimmed = message.trimStart()
  const command = parseBuiltinWorkflowSlashCommandMessage(trimmed)
  if (!command) return message

  if (command.slug === 'ultracode') {
    const task = trimmed.slice(command.command.length).trimStart()
    return task
      ? `ultracode: ${task}`
      : 'ultracode: Ask me what task should be turned into a dynamic workflow, then write and run that workflow after I answer.'
  }

  return trimmed
}
