import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTerminalCwd } from './terminal-cwd'

test('resolveTerminalCwd preserves an existing directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-terminal-cwd-'))

  try {
    expect(resolveTerminalCwd(root, 'fallback')).toBe(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveTerminalCwd falls back when the requested path is missing or a file', () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-terminal-cwd-'))
  const fallback = join(root, 'fallback')
  const file = join(root, 'file')

  try {
    writeFileSync(file, '', 'utf-8')
    expect(resolveTerminalCwd(join(root, 'missing'), fallback)).toBe(fallback)
    expect(resolveTerminalCwd(file, fallback)).toBe(fallback)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
