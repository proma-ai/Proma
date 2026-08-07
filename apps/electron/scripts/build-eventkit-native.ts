#!/usr/bin/env bun
/** Build the in-process macOS EventKit N-API addon for Electron main. */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const source = resolve(appDir, 'native/eventkit/macos-eventkit-addon.mm')
const output = resolve(appDir, 'resources/eventkit/macos-eventkit.node')
const napiHeaders = resolve(appDir, '../../node_modules/node-addon-api')
// Electron uses stable Node-API; use the locally installed Node headers only for declarations.
const nodeVersion = execFileSync('node', ['-p', 'process.versions.node'], { encoding: 'utf8' }).trim()
const nodeApiHeaders = resolve(homedir(), 'Library/Caches/node-gyp', nodeVersion, 'include/node')
const devElectronApp = resolve(appDir, '../../node_modules/electron/dist/Electron.app')
const devElectronInfo = resolve(devElectronApp, 'Contents/Info.plist')
const entitlements = resolve(appDir, 'resources/entitlements.mac.plist')

if (process.platform !== 'darwin') {
  console.log('[eventkit-native] skipped (macOS only)')
  process.exit(0)
}
if (!existsSync(source)) throw new Error(`EventKit addon source not found: ${source}`)
// CI 不会预热 ~/.cache/node-gyp；按当前 Node 版本拉取一次 header，随后复用缓存。
if (!existsSync(resolve(nodeApiHeaders, 'node_api.h'))) execFileSync('npx', ['node-gyp', 'install', nodeVersion], { stdio: 'inherit' })
if (!existsSync(resolve(napiHeaders, 'napi.h')) || !existsSync(resolve(nodeApiHeaders, 'node_api.h'))) throw new Error(`Node-API headers not found for Node ${nodeVersion}`)
mkdirSync(dirname(output), { recursive: true })
rmSync(output, { force: true })
rmSync(resolve(appDir, 'resources/eventkit/macos-eventkit-helper'), { force: true })
execFileSync('xcrun', ['clang++', '-O2', '-std=c++17', '-DNAPI_VERSION=8', '-fobjc-arc', '-bundle', '-undefined', 'dynamic_lookup', '-framework', 'EventKit', '-framework', 'Foundation', '-I', napiHeaders, '-I', nodeApiHeaders, source, '-o', output], { stdio: 'inherit' })
chmodSync(output, 0o755)

// 开发态的 responsible process 是 Electron.app，不是最终 Proma.app。为它注入相同 usage strings
// 并重新 ad-hoc 签名，避免 bun run dev 下 TCC 因缺少 Info.plist 键而静默拒绝/不显示弹窗。
if (existsSync(devElectronInfo)) {
  execFileSync('plutil', ['-replace', 'NSCalendarsFullAccessUsageDescription', '-string', 'Proma 需要访问你选择的日历，以显示、创建和同步日程。', devElectronInfo])
  execFileSync('plutil', ['-replace', 'NSRemindersFullAccessUsageDescription', '-string', 'Proma 需要访问你选择的提醒事项列表，以同步 Todo。', devElectronInfo])
  // macOS 26+ 还会检查 EventKit entitlement；开发态 Electron 也必须带与成品相同的权限。
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, devElectronApp], { stdio: 'inherit' })
}
console.log(`[eventkit-native] built ${output}`)
