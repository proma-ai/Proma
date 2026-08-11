import { createHash } from 'node:crypto'

/**
 * 浏览器 profile 默认与工作区隔离；未归属工作区的会话只复用自身 profile。
 * 持久化 partition 仅保存于本机 Electron userData 中，绝不外发。
 */
export function resolveBrowserProfileKey(workspaceId: string | undefined, sessionId: string): string {
  return workspaceId ? `workspace:${workspaceId}` : `session:${sessionId}`
}

/** 将 profile 标识转换为稳定、不可反推工作区 ID 的 Electron 持久 partition。 */
export function buildPersistentBrowserPartition(profileKey: string): string {
  const digest = createHash('sha256').update(profileKey).digest('hex').slice(0, 32)
  return `persist:proma-browser-${digest}`
}
