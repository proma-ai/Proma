import { expect, test } from 'bun:test'
import { getPiMcpToolDescription } from './pi-mcp-tools'

test('Given AnySearch search When described to Agent Then irrelevant code.doc results trigger a general-search fallback', () => {
  const description = getPiMcpToolDescription('anysearch', 'search', 'Search public sources')
  expect(description).toContain('Search public sources')
  expect(description).toContain('known public package or framework')
  expect(description).toContain('retry a general search')
})

test('Given another MCP tool When described to Agent Then its provider description stays unchanged', () => {
  expect(getPiMcpToolDescription('github', 'search', 'Search GitHub')).toBe('Search GitHub')
  expect(getPiMcpToolDescription('anysearch', 'extract', 'Extract a page')).toBe('Extract a page')
})
