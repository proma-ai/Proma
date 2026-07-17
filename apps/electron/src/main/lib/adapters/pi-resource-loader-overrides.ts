import { basename } from 'node:path'

interface AgentsFilesResult {
  agentsFiles: Array<{ path: string; content: string }>
}

const LEGACY_AGENT_CONTEXT_FILE_NAMES = new Set(['CLAUDE.md', 'CLAUDE.MD'])

export function createPromaAgentsFilesOverride(): (base: AgentsFilesResult) => AgentsFilesResult {
  return (base) => ({
    agentsFiles: base.agentsFiles.filter((file) => !LEGACY_AGENT_CONTEXT_FILE_NAMES.has(basename(file.path))),
  })
}
