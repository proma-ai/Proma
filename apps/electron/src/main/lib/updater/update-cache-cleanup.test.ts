import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MAC_DIFFERENTIAL_CACHE_TTL_MS, createUpdateCacheCleanup, shouldDeferUpdateCacheCleanup } from './update-cache-cleanup'

const tempDirectories: string[] = []

function createFixture(platform: NodeJS.Platform = 'win32') {
  const root = mkdtempSync(join(tmpdir(), 'proma-updater-cache-'))
  tempDirectories.push(root)
  const baseCacheDirectory = join(root, 'cache-root')
  const cacheDirectory = join(baseCacheDirectory, 'com.proma.app-updater')
  const pendingDirectory = join(cacheDirectory, 'pending')
  const downloadedFile = join(pendingDirectory, 'Proma-0.20.0.exe')
  const stateFilePath = join(root, 'user-data', 'updater-cache-state.json')

  mkdirSync(pendingDirectory, { recursive: true })
  writeFileSync(downloadedFile, 'installer')

  return {
    baseCacheDirectory,
    cacheDirectory,
    downloadedFile,
    pendingDirectory,
    platform,
    stateFilePath,
  }
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('更新安装包缓存清理', () => {
  test('Given 有新更新正在检查或下载 When 旧版本健康清理到期 Then 必须延后清理共享 pending 目录', () => {
    expect(shouldDeferUpdateCacheCleanup(true, false)).toBe(true)
    expect(shouldDeferUpdateCacheCleanup(false, true)).toBe(true)
    expect(shouldDeferUpdateCacheCleanup(false, false)).toBe(false)
  })

  test('Given 尚未运行目标版本 When 启动 Then 保留待安装包以便重试', () => {
    const fixture = createFixture()
    const cleanup = createUpdateCacheCleanup(fixture)
    cleanup.recordDownloadedUpdate('0.20.0', fixture.downloadedFile)

    const result = cleanup.cleanupForRunningVersion('0.19.32')

    expect(result).toEqual({ status: 'retained', deletedCount: 0 })
    expect(existsSync(fixture.downloadedFile)).toBe(true)
    expect(existsSync(fixture.stateFilePath)).toBe(true)
  })

  test('Given 新版本已成功启动 When 清理 Then 删除 pending 内的安装包和状态文件', () => {
    const fixture = createFixture()
    const cleanup = createUpdateCacheCleanup(fixture)
    cleanup.recordDownloadedUpdate('0.20.0', fixture.downloadedFile)
    writeFileSync(join(fixture.pendingDirectory, 'update-info.json'), '{}')

    const result = cleanup.cleanupForRunningVersion('0.20.0')

    expect(result).toEqual({ status: 'cleaned', deletedCount: 2 })
    expect(existsSync(fixture.pendingDirectory)).toBe(false)
    expect(existsSync(fixture.stateFilePath)).toBe(false)
    expect(existsSync(`${fixture.stateFilePath}.bak`)).toBe(false)
  })

  test('Given 不属于 updater pending 目录的下载文件 When 记录 Then 拒绝创建清理状态', () => {
    const fixture = createFixture()
    const outsideFile = join(dirname(fixture.baseCacheDirectory), 'outside-installer.exe')
    writeFileSync(outsideFile, 'installer')
    const cleanup = createUpdateCacheCleanup(fixture)

    expect(cleanup.recordDownloadedUpdate('0.20.0', outsideFile)).toBe(false)
    expect(existsSync(fixture.stateFilePath)).toBe(false)
    expect(existsSync(outsideFile)).toBe(true)
  })

  test('Given 下载路径经过软链接目录 When 记录 Then 拒绝为其建立删除状态', () => {
    const fixture = createFixture()
    const outsideCacheDirectory = join(dirname(fixture.baseCacheDirectory), 'outside-cache')
    const linkedCacheDirectory = join(fixture.baseCacheDirectory, 'linked-cache')
    const linkedPendingDirectory = join(outsideCacheDirectory, 'pending')
    const linkedInstaller = join(linkedPendingDirectory, 'Proma-0.20.0.exe')
    mkdirSync(linkedPendingDirectory, { recursive: true })
    writeFileSync(linkedInstaller, 'installer')
    symlinkSync(outsideCacheDirectory, linkedCacheDirectory)

    const cleanup = createUpdateCacheCleanup(fixture)

    expect(cleanup.recordDownloadedUpdate('0.20.0', join(linkedCacheDirectory, 'pending', 'Proma-0.20.0.exe'))).toBe(false)
    expect(existsSync(fixture.stateFilePath)).toBe(false)
    expect(existsSync(linkedInstaller)).toBe(true)
  })

  test('Given 缓存状态无法持久化 When 下载完成 Then 不抛错且保留可安装文件', () => {
    const fixture = createFixture()
    const cleanup = createUpdateCacheCleanup({ ...fixture, stateFilePath: join('/dev/null', 'updater-cache-state.json') })

    expect(cleanup.recordDownloadedUpdate('0.20.0', fixture.downloadedFile)).toBe(false)
    expect(existsSync(fixture.downloadedFile)).toBe(true)
  })

  test('Given pending 含不受信任目录 When 清理 Then 保留状态并拒绝递归删除', () => {
    const fixture = createFixture()
    const cleanup = createUpdateCacheCleanup(fixture)
    cleanup.recordDownloadedUpdate('0.20.0', fixture.downloadedFile)
    const unexpectedDirectory = join(fixture.pendingDirectory, 'unexpected')
    mkdirSync(unexpectedDirectory)
    writeFileSync(join(unexpectedDirectory, 'keep'), 'keep')

    const result = cleanup.cleanupForRunningVersion('0.20.0')

    expect(result.status).toBe('skipped-unsafe')
    expect(existsSync(fixture.stateFilePath)).toBe(true)
    expect(readFileSync(join(unexpectedDirectory, 'keep'), 'utf8')).toBe('keep')
  })

  test('Given 删除被文件系统拒绝 When 清理 Then 保留状态供下次启动重试', () => {
    const fixture = createFixture()
    const cleanup = createUpdateCacheCleanup(fixture)
    cleanup.recordDownloadedUpdate('0.20.0', fixture.downloadedFile)
    chmodSync(fixture.pendingDirectory, 0o500)

    const result = cleanup.cleanupForRunningVersion('0.20.0')

    chmodSync(fixture.pendingDirectory, 0o700)
    expect(result.status).toBe('failed')
    expect(existsSync(fixture.stateFilePath)).toBe(true)
    expect(existsSync(fixture.downloadedFile)).toBe(true)
  })

  test('Given macOS 差分缓存过期且有新待安装更新 When 后续启动 Then 回收差分缓存但保留新安装包', () => {
    const fixture = createFixture('darwin')
    let now = 1_000
    const cleanup = createUpdateCacheCleanup({ ...fixture, now: () => now })
    cleanup.recordDownloadedUpdate('0.20.0', fixture.downloadedFile)
    writeFileSync(join(fixture.cacheDirectory, 'update.zip'), 'differential-base')
    writeFileSync(join(fixture.cacheDirectory, 'current.blockmap'), 'blockmap')
    writeFileSync(join(fixture.cacheDirectory, 'unrelated-file'), 'keep')

    cleanup.cleanupForRunningVersion('0.20.0')
    mkdirSync(fixture.pendingDirectory)
    const nextInstaller = join(fixture.pendingDirectory, 'Proma-0.21.0.zip')
    writeFileSync(nextInstaller, 'next-installer')
    cleanup.recordDownloadedUpdate('0.21.0', nextInstaller)

    now += MAC_DIFFERENTIAL_CACHE_TTL_MS
    const expiredResult = cleanup.cleanupForRunningVersion('0.20.0')

    expect(expiredResult).toEqual({ status: 'cleaned', deletedCount: 2 })
    expect(existsSync(join(fixture.cacheDirectory, 'update.zip'))).toBe(false)
    expect(existsSync(join(fixture.cacheDirectory, 'current.blockmap'))).toBe(false)
    expect(readFileSync(join(fixture.cacheDirectory, 'unrelated-file'), 'utf8')).toBe('keep')
    expect(existsSync(nextInstaller)).toBe(true)
    expect(existsSync(fixture.stateFilePath)).toBe(true)
  })
})
