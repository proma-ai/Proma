#!/usr/bin/env bun
/**
 * 同步 Electron 打包时需要保留为 external 的主进程运行时依赖。
 *
 * Bun workspace 会把依赖 hoist 到仓库根 node_modules；electron-builder 的 files
 * 规则以 apps/electron 为 appDir，因此打包前需要把 external 依赖闭包复制到
 * apps/electron/node_modules，保证 packaged app 中 Node 模块解析可用。
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

interface RuntimeDependency {
  name: string
  optional: boolean
}

interface SyncContext {
  sourceNodeModules: string
  targetNodeModules: string
  copiedPackages: Map<string, string>
  topLevelPackageSources: Map<string, string>
  skippedOptionalPackages: string[]
}

export interface SyncRuntimeDepsOptions {
  sourceNodeModules?: string
  targetNodeModules?: string
  externalRuntimePackages?: readonly string[]
  /** 是否在同步前清空目标 node_modules；打包需要 true，开发启动使用 false 避免破坏本地调试内容。 */
  cleanTarget?: boolean
}

export interface SyncRuntimeDepsResult {
  copiedPackageCount: number
  copiedPackages: string[]
  skippedOptionalPackages: string[]
}

export const EXTERNAL_RUNTIME_PACKAGES: readonly string[] = [
  '@anthropic-ai/claude-agent-sdk',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  'pdfjs-dist',
]

const appDir = resolve(import.meta.dir, '..')
const repoRoot = resolve(appDir, '../..')
const repoNodeModules = join(repoRoot, 'node_modules')
const bunVirtualNodeModules = join(repoNodeModules, '.bun', 'node_modules')
const defaultSourceNodeModules = existsSync(bunVirtualNodeModules) ? bunVirtualNodeModules : repoNodeModules
const defaultTargetNodeModules = join(appDir, 'node_modules')

function getPackageDir(nodeModulesDir: string, packageName: string): string {
  if (packageName.startsWith('@')) {
    const parts = packageName.split('/')
    const scope = parts[0]
    const name = parts[1]
    if (!scope || !name) throw new Error(`非法 scoped package 名称: ${packageName}`)
    return join(nodeModulesDir, scope, name)
  }
  return join(nodeModulesDir, packageName)
}

function resolvePackageFromNodeModules(nodeModulesDir: string, packageName: string): string | undefined {
  const packageDir = getPackageDir(nodeModulesDir, packageName)
  if (existsSync(join(packageDir, 'package.json'))) {
    return realpathSync(packageDir)
  }
  return undefined
}

function resolvePackageUpwards(startDir: string, packageName: string): string | undefined {
  let currentDir = resolve(startDir)

  while (true) {
    const resolvedPackageDir = resolvePackageFromNodeModules(join(currentDir, 'node_modules'), packageName)
    if (resolvedPackageDir) return resolvedPackageDir

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) return undefined
    currentDir = parentDir
  }
}

function resolvePackageSourceDir(ctx: SyncContext, packageName: string, resolveFromDir?: string): string | undefined {
  if (resolveFromDir) {
    const parentResolvedDir = resolvePackageUpwards(resolveFromDir, packageName)
    if (parentResolvedDir) return parentResolvedDir
  }

  for (const nodeModulesDir of [ctx.sourceNodeModules, bunVirtualNodeModules, repoNodeModules]) {
    const resolvedPackageDir = resolvePackageFromNodeModules(nodeModulesDir, packageName)
    if (resolvedPackageDir) return resolvedPackageDir
  }

  return undefined
}

function readPackageManifest(sourceDir: string): PackageManifest {
  return JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf-8')) as PackageManifest
}

function listRuntimeDependencies(manifest: PackageManifest): RuntimeDependency[] {
  const dependencies = Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, optional: false }))
  const optionalDependencies = Object.keys(manifest.optionalDependencies ?? {}).map((name) => ({ name, optional: true }))
  return [...dependencies, ...optionalDependencies]
}

function copyPackage(
  ctx: SyncContext,
  packageName: string,
  optional = false,
  resolveFromDir?: string,
  targetNodeModules = ctx.targetNodeModules,
  sourceAncestors = new Set<string>(),
): void {
  const sourceDir = resolvePackageSourceDir(ctx, packageName, resolveFromDir)
  if (!sourceDir) {
    if (optional) {
      ctx.skippedOptionalPackages.push(packageName)
      return
    }
    throw new Error(`缺少运行时依赖: ${packageName} (${getPackageDir(ctx.sourceNodeModules, packageName)})`)
  }
  const manifest = readPackageManifest(sourceDir)
  const isTopLevel = targetNodeModules === ctx.targetNodeModules

  const targetDir = getPackageDir(targetNodeModules, packageName)
  const targetKey = resolve(targetDir)
  const existingSourceDir = ctx.copiedPackages.get(targetKey)
  if (existingSourceDir) {
    if (existingSourceDir === sourceDir) return
    throw new Error(`运行时依赖版本冲突: ${packageName} 已复制自 ${existingSourceDir}，又解析到 ${sourceDir}`)
  }

  ctx.copiedPackages.set(targetKey, sourceDir)
  if (isTopLevel) ctx.topLevelPackageSources.set(packageName, sourceDir)

  mkdirSync(dirname(targetDir), { recursive: true })
  rmSync(targetDir, { recursive: true, force: true })
  cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: true,
    force: true,
    preserveTimestamps: true,
  })

  const nextAncestors = new Set(sourceAncestors)
  nextAncestors.add(sourceDir)
  for (const dependency of listRuntimeDependencies(manifest)) {
    copyDependency(ctx, dependency, sourceDir, targetDir, nextAncestors)
  }
}

function copyDependency(
  ctx: SyncContext,
  dependency: RuntimeDependency,
  parentSourceDir: string,
  parentTargetDir: string,
  sourceAncestors: Set<string>,
): void {
  const sourceDir = resolvePackageSourceDir(ctx, dependency.name, parentSourceDir)
  if (!sourceDir) {
    if (dependency.optional) {
      ctx.skippedOptionalPackages.push(dependency.name)
      return
    }
    throw new Error(`缺少运行时依赖: ${dependency.name} (${parentSourceDir})`)
  }

  if (sourceAncestors.has(sourceDir)) return

  const topLevelSourceDir = ctx.topLevelPackageSources.get(dependency.name)
  if (!topLevelSourceDir || topLevelSourceDir === sourceDir) {
    copyPackage(ctx, dependency.name, dependency.optional, parentSourceDir, ctx.targetNodeModules, sourceAncestors)
    return
  }

  copyPackage(
    ctx,
    dependency.name,
    dependency.optional,
    parentSourceDir,
    join(parentTargetDir, 'node_modules'),
    sourceAncestors,
  )
}

function assertNoAbsoluteSymlinks(dir: string): void {
  if (!existsSync(dir)) return
  const stack = [dir]
  const offenders: string[] = []
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry)
      const stat = lstatSync(fullPath)
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(fullPath)
        if (target.startsWith('/')) offenders.push(fullPath)
        continue
      }
      if (stat.isDirectory()) stack.push(fullPath)
    }
  }
  if (offenders.length > 0) {
    throw new Error(`检测到绝对 symlink，会导致打包后模块解析失效: ${offenders.slice(0, 10).join(', ')}`)
  }
}

function prepareTargetNodeModules(sourceNodeModules: string, targetNodeModules: string): void {
  const source = resolve(sourceNodeModules)
  const target = resolve(targetNodeModules)
  if (source === target) {
    throw new Error('sourceNodeModules 与 targetNodeModules 不能相同，避免误删源依赖')
  }
  if (basename(target) !== 'node_modules') {
    throw new Error(`拒绝清理非 node_modules 目录: ${target}`)
  }

  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
}

export function syncRuntimeDeps(options: SyncRuntimeDepsOptions = {}): SyncRuntimeDepsResult {
  const ctx: SyncContext = {
    sourceNodeModules: options.sourceNodeModules ?? defaultSourceNodeModules,
    targetNodeModules: options.targetNodeModules ?? defaultTargetNodeModules,
    copiedPackages: new Map<string, string>(),
    topLevelPackageSources: new Map<string, string>(),
    skippedOptionalPackages: [],
  }
  const externalRuntimePackages = options.externalRuntimePackages ?? EXTERNAL_RUNTIME_PACKAGES

  if (options.cleanTarget ?? true) {
    prepareTargetNodeModules(ctx.sourceNodeModules, ctx.targetNodeModules)
  } else {
    const source = resolve(ctx.sourceNodeModules)
    const target = resolve(ctx.targetNodeModules)
    if (source === target) {
      throw new Error('sourceNodeModules 与 targetNodeModules 不能相同，避免覆盖源依赖')
    }
    if (basename(target) !== 'node_modules') {
      throw new Error(`拒绝同步到非 node_modules 目录: ${target}`)
    }
    mkdirSync(target, { recursive: true })
  }

  for (const packageName of externalRuntimePackages) {
    copyPackage(ctx, packageName)
  }

  assertNoAbsoluteSymlinks(ctx.targetNodeModules)

  return {
    copiedPackageCount: ctx.copiedPackages.size,
    copiedPackages: [...ctx.copiedPackages.keys()],
    skippedOptionalPackages: [...ctx.skippedOptionalPackages],
  }
}

function main(): void {
  const result = syncRuntimeDeps({ cleanTarget: !process.argv.includes('--no-clean') })
  const skipped = result.skippedOptionalPackages.length > 0
    ? `，跳过未安装 optional 依赖 ${result.skippedOptionalPackages.length} 个`
    : ''
  console.log(`[runtime-deps] 已同步 ${result.copiedPackageCount} 个主进程运行时依赖${skipped}`)
}

if (import.meta.main) {
  main()
}
