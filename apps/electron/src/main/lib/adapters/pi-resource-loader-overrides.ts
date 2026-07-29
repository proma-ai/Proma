import { basename } from 'node:path'

interface AgentsFilesResult {
  agentsFiles: Array<{ path: string; content: string }>
}

// Proma injects its own system prompt. Do not inherit instruction files from a
// user-selected local project or any of its ancestors.
const LEGACY_AGENT_CONTEXT_FILE_NAMES = new Set([
  'CLAUDE.md',
  'CLAUDE.MD',
  'AGENTS.md',
  'AGENTS.MD',
])

export function createPromaAgentsFilesOverride(): (base: AgentsFilesResult) => AgentsFilesResult {
  return (base) => ({
    agentsFiles: base.agentsFiles.filter((file) => !LEGACY_AGENT_CONTEXT_FILE_NAMES.has(basename(file.path))),
  })
}
