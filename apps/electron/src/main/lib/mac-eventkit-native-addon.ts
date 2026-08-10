import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app } from 'electron'

export type EventKitEntity = 'calendar' | 'reminder'
type EventKitCommand = 'authorizationStatus' | 'requestAccess' | 'listWritableTargets' | 'listTargets' | 'listItems' | 'upsert' | 'remove'
type Addon = { command: (command: EventKitCommand, entity: EventKitEntity, payloadJson: string) => Promise<string>; subscribeChanges?: (listener: () => void) => void }

// 主进程由 esbuild 输出为 CJS，使用 __filename 保持开发和打包路径一致。
const require = createRequire(__filename)
let addon: Addon | null = null

function addonPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'eventkit', 'macos-eventkit.node')
    : join(__dirname, 'resources', 'eventkit', 'macos-eventkit.node')
}

function nativeAddon(): Addon {
  if (process.platform !== 'darwin') throw new Error('EventKit is only available on macOS')
  if (!addon) addon = require(addonPath()) as Addon
  return addon
}

/** EventKit 在 Electron 主进程内执行，TCC 将授权归属到带 Info.plist 的 Proma.app，而不是短命 helper。 */
export function subscribeMacEventKitNativeChanges(listener: () => void): boolean {
  if (process.platform !== 'darwin') return false
  const native = nativeAddon()
  if (!native.subscribeChanges) return false
  native.subscribeChanges(listener)
  return true
}

export async function callMacEventKitNativeAddon<T>(command: EventKitCommand, entity: EventKitEntity, payload: object = {}): Promise<T> {
  const result = await nativeAddon().command(command, entity, JSON.stringify(payload))
  return JSON.parse(result) as T
}
