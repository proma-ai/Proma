import { describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Vault 文件夹创建竞态', () => {
  test('Given mkdir 在预检查后被并发创建者抢占 When createFolder 命中 EEXIST Then 转换为稳定的同名错误', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-vault-eexist-'))
    try {
      const actualFs = await import('node:fs')
      const realMkdirSync = actualFs.mkdirSync
      // createFolder 先 existsSync 再 mkdirSync；这里让最终 mkdir 抛出 EEXIST，
      // 模拟另一创建者在两次检查之间抢先落盘，验证 catch 分支的错误转换。
      mock.module('node:fs', () => ({
        ...actualFs,
        mkdirSync: ((target: unknown, options?: unknown): unknown => {
          if (typeof target === 'string' && target.endsWith('/Raced') && options === undefined) {
            const error = new Error(`EEXIST: file already exists, mkdir '${target}'`) as NodeJS.ErrnoException
            error.code = 'EEXIST'
            throw error
          }
          return (realMkdirSync as (path: unknown, options?: unknown) => unknown)(target, options)
        }) as typeof actualFs.mkdirSync,
      }))
      const { createVaultFileSystem } = await import('./vault-service')

      const vault = createVaultFileSystem(root)
      expect(() => vault.createFolder('Raced')).toThrow('同名文件或文件夹已存在')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
