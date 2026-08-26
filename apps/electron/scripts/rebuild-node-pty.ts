#!/usr/bin/env bun
/**
 * Rebuild node-pty against the Electron version actually resolved by Bun.
 *
 * `sync-runtime-deps.ts` intentionally removes apps/electron/node_modules before
 * packaging, so the workspace's dev binary is no longer on PATH. Resolve Electron
 * from Bun's root virtual store and invoke the pinned rebuild CLI through bunx.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const appDir = resolve(import.meta.dir, '..')
const repoRoot = resolve(appDir, '../..')
const bunStore = join(repoRoot, 'node_modules', '.bun')

function compareVersion(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const versions = existsSync(bunStore)
  ? readdirSync(bunStore)
    .filter((entry) => entry.startsWith('electron@'))
    .map((entry) => join(bunStore, entry, 'node_modules', 'electron', 'package.json'))
    .filter(existsSync)
    .map((manifest) => JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown })
    .map((manifest) => typeof manifest.version === 'string' ? manifest.version : undefined)
    .filter((version): version is string => Boolean(version))
  : []

const electronVersion = versions.sort(compareVersion).at(-1)
if (!electronVersion) {
  throw new Error('未找到 Bun 已解析的 Electron 版本；请先在仓库根目录执行 bun install')
}

console.log(`[rebuild:node-pty] Electron ${electronVersion}`)
execFileSync('bunx', ['@electron/rebuild@4.2.0', '--version', electronVersion, '--force', '--which-module', 'node-pty'], {
  cwd: appDir,
  stdio: 'inherit',
})
