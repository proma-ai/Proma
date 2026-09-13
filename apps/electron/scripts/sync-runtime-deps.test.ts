import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJsonFileAtomic } from '../src/main/lib/safe-file'
import { syncRuntimeDeps } from './sync-runtime-deps'

const roots: string[] = []

interface FixtureManifest {
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function createFixture(): { sourceNodeModules: string; targetNodeModules: string } {
  const root = mkdtempSync(join(tmpdir(), 'proma-runtime-deps-'))
  roots.push(root)
  return {
    sourceNodeModules: join(root, 'source', 'node_modules'),
    targetNodeModules: join(root, 'app', 'node_modules'),
  }
}

function addPackage(nodeModules: string, name: string, manifest: FixtureManifest): string {
  const dir = join(nodeModules, name)
  mkdirSync(dir, { recursive: true })
  writeJsonFileAtomic(join(dir, 'package.json'), { name, ...manifest }, true)
  return dir
}

function readVersion(nodeModules: string, name: string): string {
  const manifest = JSON.parse(readFileSync(join(nodeModules, name, 'package.json'), 'utf8')) as FixtureManifest
  return manifest.version
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('同步 Electron 运行时依赖', () => {
  test('当 hoisted 依赖满足版本范围时，复制完整依赖闭包', () => {
    const fixture = createFixture()
    addPackage(fixture.sourceNodeModules, 'fixture-sdk', {
      version: '1.0.0', dependencies: { 'fixture-highlight': '^10.7.0' },
    })
    addPackage(fixture.sourceNodeModules, 'fixture-highlight', { version: '10.7.3' })

    const result = syncRuntimeDeps({ ...fixture, externalRuntimePackages: ['fixture-sdk'] })

    expect(result.copiedPackageCount).toBe(2)
    expect(readVersion(fixture.targetNodeModules, 'fixture-highlight')).toBe('10.7.3')
  })

  test.each([true, false])('当嵌套依赖缺失且 hoisted 版本不兼容时，提示重新安装（cleanTarget=%s）', (cleanTarget) => {
    const fixture = createFixture()
    addPackage(fixture.sourceNodeModules, 'fixture-sdk', {
      version: '1.0.0', dependencies: { 'fixture-highlight': '10.7.3' },
    })
    addPackage(fixture.sourceNodeModules, 'fixture-highlight', { version: '11.11.1' })

    expect(() => syncRuntimeDeps({
      ...fixture, cleanTarget, externalRuntimePackages: ['fixture-sdk'],
    })).toThrow(/fixture-highlight.*10\.7\.3.*11\.11\.1.*bun install --frozen-lockfile/)
    expect(existsSync(join(fixture.targetNodeModules, 'fixture-highlight'))).toBe(false)
  })

  test('当 SDK 有自己的兼容版本时，保留其他入口所需的不同版本', () => {
    const fixture = createFixture()
    const sdk = addPackage(fixture.sourceNodeModules, 'fixture-sdk', {
      version: '1.0.0', dependencies: { 'fixture-highlight': '10.7.3' },
    })
    addPackage(fixture.sourceNodeModules, 'fixture-highlight', { version: '11.11.1' })
    addPackage(join(sdk, 'node_modules'), 'fixture-highlight', { version: '10.7.3' })

    syncRuntimeDeps({ ...fixture, externalRuntimePackages: ['fixture-highlight', 'fixture-sdk'] })

    expect(readVersion(fixture.targetNodeModules, 'fixture-highlight')).toBe('11.11.1')
    expect(readVersion(join(fixture.targetNodeModules, 'fixture-sdk', 'node_modules'), 'fixture-highlight')).toBe('10.7.3')
  })

  test('开发态同步用已修复的依赖替换旧副本，并保留无关本地包', () => {
    const fixture = createFixture()
    const sdk = addPackage(fixture.sourceNodeModules, 'fixture-sdk', {
      version: '1.0.0', dependencies: { 'fixture-highlight': '10.7.3' },
    })
    addPackage(join(sdk, 'node_modules'), 'fixture-highlight', { version: '10.7.3' })
    addPackage(fixture.targetNodeModules, 'fixture-highlight', { version: '11.11.1' })
    addPackage(fixture.targetNodeModules, 'fixture-local', { version: '1.0.0' })

    syncRuntimeDeps({ ...fixture, cleanTarget: false, externalRuntimePackages: ['fixture-sdk'] })

    expect(readVersion(fixture.targetNodeModules, 'fixture-highlight')).toBe('10.7.3')
    expect(readVersion(fixture.targetNodeModules, 'fixture-local')).toBe('1.0.0')
  })

  test('平台未安装的可选依赖不会阻止同步', () => {
    const fixture = createFixture()
    addPackage(fixture.sourceNodeModules, 'fixture-sdk', {
      version: '1.0.0', optionalDependencies: { 'fixture-optional-missing': '^1.0.0' },
    })

    const result = syncRuntimeDeps({ ...fixture, externalRuntimePackages: ['fixture-sdk'] })

    expect(result.skippedOptionalPackages).toEqual(['fixture-optional-missing'])
    expect(readVersion(fixture.targetNodeModules, 'fixture-sdk')).toBe('1.0.0')
  })
})
