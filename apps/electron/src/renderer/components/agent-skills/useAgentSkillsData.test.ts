import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const hookPath = resolve(import.meta.dir, 'useAgentSkillsData.ts')

test('Given an MCP enable handshake writes a temporary disabled config When a workspace watcher reloads Then the optimistic switch intent stays visible until validation completes', () => {
  const source = readFileSync(hookPath, 'utf8')

  expect(source).toContain('const mcpToggleIntentsRef = React.useRef(new Map<string, boolean>())')
  expect(source).toContain('mcpToggleIntentsRef.current.set(name, enabled)')
  expect(source).toContain('for (const [name, enabled] of mcpToggleIntentsRef.current)')
  expect(source).toContain('mcpToggleIntentsRef.current.delete(name)')
  expect(source).toContain('mcpConfigMutationRevisionRef.current !== mcpConfigMutationRevision')
})
