import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVaultFileSystem } from './vault-service'

const temporaryVaults: string[] = []

function createVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'proma-vault-service-'))
  temporaryVaults.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryVaults.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Vault 文件树', () => {
  test('Given 通过 Vault 接口新建嵌套空文件夹 When 枚举 Vault Then 返回每一级文件夹供侧栏立即显示', () => {
    const root = createVault()
    const vault = createVaultFileSystem(root)
    vault.createFolder('Projects')
    vault.createFolder('Projects/2026')

    const entries = vault.listFiles()

    expect(entries).toEqual([
      { kind: 'folder', relativePath: 'Projects', name: 'Projects' },
      { kind: 'folder', relativePath: 'Projects/2026', name: '2026' },
    ])
  })

  test('Given Markdown 笔记与空文件夹 When 枚举 Vault Then 同时返回文件和文件夹条目', () => {
    const root = createVault()
    mkdirSync(join(root, 'Notes'))
    mkdirSync(join(root, 'Empty'))
    writeFileSync(join(root, 'Notes', 'Plan.md'), '# Plan\n', 'utf-8')

    const entries = createVaultFileSystem(root).listFiles()

    expect(entries).toEqual([
      { kind: 'folder', relativePath: 'Empty', name: 'Empty' },
      { kind: 'folder', relativePath: 'Notes', name: 'Notes' },
      expect.objectContaining({
        kind: 'file',
        relativePath: 'Notes/Plan.md',
        name: 'Plan.md',
        size: Buffer.byteLength('# Plan\n', 'utf-8'),
      }),
    ])
  })

  test('Given folder creation races with another creator When both target the same path Then exactly one succeeds', async () => {
    const root = createVault()
    const vault = createVaultFileSystem(root)

    const results = await Promise.allSettled([
      Promise.resolve().then(() => vault.createFolder('Concurrent')),
      Promise.resolve().then(() => vault.createFolder('Concurrent')),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(vault.listFiles()).toEqual([
      { kind: 'folder', relativePath: 'Concurrent', name: 'Concurrent' },
    ])
  })

  test('Given hidden folders or symbolic links When 枚举 Vault Then 不暴露它们或其内容', () => {
    const root = createVault()
    const outside = createVault()
    mkdirSync(join(root, '.obsidian'))
    writeFileSync(join(root, '.obsidian', 'hidden.md'), '# hidden\n', 'utf-8')
    mkdirSync(join(outside, 'linked'))
    writeFileSync(join(outside, 'linked', 'outside.md'), '# outside\n', 'utf-8')
    symlinkSync(join(outside, 'linked'), join(root, 'linked'))

    const entries = createVaultFileSystem(root).listFiles()

    expect(entries).toEqual([])
  })
})
