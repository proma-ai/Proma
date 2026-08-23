import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEV_BUNDLE_RELATIVE_PATHS,
  prepareDevBundles,
  waitForDevBundles,
} from './dev-bundle-readiness'

const temporaryRoots: string[] = []

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'proma-dev-bundles-'))
  temporaryRoots.push(root)
  return root
}

function writeBundle(root: string, relativePath: string, content = 'bundle'): void {
  const bundlePath = join(root, relativePath)
  mkdirSync(dirname(bundlePath), { recursive: true })
  writeFileSync(bundlePath, content)
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Electron 开发态 bundle readiness', () => {
  test('given 上一轮 bundle when 准备新一轮开发构建 then 仅清理目标 bundle', () => {
    const root = createTemporaryRoot()
    for (const relativePath of DEV_BUNDLE_RELATIVE_PATHS) writeBundle(root, relativePath)
    writeBundle(root, 'dist/renderer/index.html')

    prepareDevBundles(root)

    for (const relativePath of DEV_BUNDLE_RELATIVE_PATHS) {
      expect(existsSync(join(root, relativePath))).toBe(false)
    }
    expect(existsSync(join(root, 'dist/renderer/index.html'))).toBe(true)
  })

  test('given watcher 正在首次构建 when 只生成部分 bundle then Electron 继续等待', async () => {
    const root = createTemporaryRoot()
    let ready = false
    const readiness = waitForDevBundles({
      root,
      timeoutMs: 1_000,
      pollIntervalMs: 5,
    }).then(() => {
      ready = true
    })

    writeBundle(root, DEV_BUNDLE_RELATIVE_PATHS[0])
    writeBundle(root, DEV_BUNDLE_RELATIVE_PATHS[1])
    await Bun.sleep(20)
    expect(ready).toBe(false)

    writeBundle(root, DEV_BUNDLE_RELATIVE_PATHS[2])
    await readiness
    expect(ready).toBe(true)
  })

  test('given bundle 缺失或为空 when watcher 未成功完成 then 明确超时失败', async () => {
    const root = createTemporaryRoot()
    writeBundle(root, DEV_BUNDLE_RELATIVE_PATHS[0])
    writeBundle(root, DEV_BUNDLE_RELATIVE_PATHS[1])
    writeBundle(root, DEV_BUNDLE_RELATIVE_PATHS[2], '')

    await expect(waitForDevBundles({
      root,
      timeoutMs: 20,
      pollIntervalMs: 5,
    })).rejects.toThrow(`等待开发态 bundle 超时: ${DEV_BUNDLE_RELATIVE_PATHS[2]}`)
  })
})
