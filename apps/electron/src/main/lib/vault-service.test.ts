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

  test('Given 文件夹数量达到文件上限 When 枚举 Vault Then 目录不占用文件配额', () => {
    const root = createVault()
    mkdirSync(join(root, 'Notes'))
    for (let index = 0; index < 5_000; index += 1) {
      writeFileSync(join(root, 'Notes', `note-${String(index).padStart(4, '0')}.md`), '', 'utf-8')
    }
    mkdirSync(join(root, 'Empty'))

    const entries = createVaultFileSystem(root).listFiles()

    expect(entries.filter((entry) => entry.kind === 'file')).toHaveLength(5_000)
    expect(entries.filter((entry) => entry.kind === 'folder')).toEqual([
      { kind: 'folder', relativePath: 'Empty', name: 'Empty' },
      { kind: 'folder', relativePath: 'Notes', name: 'Notes' },
    ])
  }, 30_000)

  test('Given 目录嵌套达到深度边界 When 枚举 Vault Then 不返回无法展开的超限文件夹', () => {
    const root = createVault()
    const segments = Array.from({ length: 18 }, (_, index) => `d${index + 1}`)
    let current = root
    for (const segment of segments) {
      current = join(current, segment)
      mkdirSync(current)
    }
    const level16 = segments.slice(0, 16).join('/')
    const level17 = segments.slice(0, 17).join('/')
    writeFileSync(join(root, level16, 'visible.md'), '# visible\n', 'utf-8')
    writeFileSync(join(root, level17, 'hidden.md'), '# hidden\n', 'utf-8')

    const entries = createVaultFileSystem(root).listFiles()
    const folders = entries.filter((entry) => entry.kind === 'folder').map((entry) => entry.relativePath)

    expect(folders).toHaveLength(16)
    expect(folders.at(-1)).toBe(level16)
    expect(entries.some((entry) => entry.kind === 'file' && entry.relativePath === `${level16}/visible.md`)).toBe(true)
    expect(entries.some((entry) => entry.relativePath === level17)).toBe(false)
    expect(entries.some((entry) => entry.relativePath === `${level17}/hidden.md`)).toBe(false)
  })

  test('Given 目标路径已被其他创建者创建 When 重复创建同名文件夹 Then 返回稳定的同名错误且只保留一个目录', () => {
    const root = createVault()
    const vault = createVaultFileSystem(root)
    vault.createFolder('Concurrent')

    expect(() => vault.createFolder('Concurrent')).toThrow('同名文件或文件夹已存在')
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
