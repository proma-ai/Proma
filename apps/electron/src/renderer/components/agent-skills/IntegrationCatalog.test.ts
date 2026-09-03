import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compareCatalogConnectionCards } from './integration-catalog'

const catalogPath = resolve(import.meta.dir, 'IntegrationCatalog.tsx')

test('Given a configured credential MCP When it is listed in the connection catalog Then it exposes an enable switch instead of a disconnect action', () => {
  const source = readFileSync(catalogPath, 'utf8')
  const credentialSection = source.slice(source.indexOf('...credentials.map'), source.indexOf('...clis.map'))

  expect(credentialSection).toContain('enabled: enabledMcpNames.has(integration.serverName)')
  expect(credentialSection).not.toContain('enabled: status === \'connected\'')
})

test('Given connection cards When their enabled state changes Then catalog order remains stable', () => {
  const cards = [
    { priority: 1, statusRank: 1 },
    { priority: 2, statusRank: 3 },
    { priority: 3, statusRank: 2 },
  ]
  const before = [...cards].sort(compareCatalogConnectionCards)
  const after = cards
    .map((card, index) => ({ ...card, statusRank: index === 0 ? 3 : 1 }))
    .sort(compareCatalogConnectionCards)

  expect(after.map((card) => card.priority)).toEqual(before.map((card) => card.priority))
})
