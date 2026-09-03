import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const orchestratorPath = resolve(import.meta.dir, 'agent-orchestrator.ts')

test('Given an enabled workspace MCP When an Agent run starts Then tool discovery waits for its handshake instead of silently skipping the current turn', () => {
  const source = readFileSync(orchestratorPath, 'utf8')
  expect(source).not.toContain('required: false')
  expect((source.match(/required: true/g) ?? []).length).toBeGreaterThanOrEqual(2)
})
