import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireTerminalCwd, resolveTerminalCwd } from './terminal-cwd'

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
    mkdirSync(fallback)
    writeFileSync(file, '', 'utf-8')
    expect(resolveTerminalCwd(join(root, 'missing'), fallback)).toBe(fallback)
    expect(resolveTerminalCwd(file, fallback)).toBe(fallback)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('requireTerminalCwd rejects missing and non-directory Agent cwd values', () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-terminal-cwd-'))
  const file = join(root, 'file')

  try {
    writeFileSync(file, '', 'utf-8')
    expect(() => requireTerminalCwd(join(root, 'missing'))).toThrow('终端工作目录不存在或不是目录')
    expect(() => requireTerminalCwd(file)).toThrow('终端工作目录不存在或不是目录')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
