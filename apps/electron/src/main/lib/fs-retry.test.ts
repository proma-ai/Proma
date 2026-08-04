import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renameIfDestinationAbsentWithRetry } from './fs-retry'

test('renameIfDestinationAbsentWithRetry preserves an existing destination', () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-fs-retry-'))
  const source = join(root, 'source')
  const destination = join(root, 'destination')

  try {
    mkdirSync(source)
    mkdirSync(destination)
    writeFileSync(join(source, 'SKILL.md'), 'source', 'utf-8')
    writeFileSync(join(destination, 'SKILL.md'), 'destination', 'utf-8')

    expect(renameIfDestinationAbsentWithRetry(source, destination)).toBe(false)
    expect(existsSync(source)).toBe(true)
    expect(readFileSync(join(destination, 'SKILL.md'), 'utf-8')).toBe('destination')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
