import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export type ProjectRootHealthStatus = 'available' | 'missing' | 'not_directory' | 'unavailable'

const projectRootStatusChecks = new Map<string, Promise<ProjectRootHealthStatus>>()

function statusCheckKey(projectRootPath: string): string {
  return resolve(projectRootPath)
}

async function checkProjectRootStatus(projectRootPath: string): Promise<ProjectRootHealthStatus> {
  try {
    const stats = await stat(projectRootPath)
    if (!stats.isDirectory()) return 'not_directory'
    await access(projectRootPath, constants.R_OK | constants.W_OK | constants.X_OK)
    return 'available'
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable'
  }
}

/**
 * 异步检查用户选择的本地项目根。相同路径的并发检查共享同一 Promise，
 * 防止工作区列表、Agent 预检和文件保存同时触发重复的慢速文件系统请求。
 */
export function getLocalProjectRootStatus(projectRootPath: string | undefined): Promise<ProjectRootHealthStatus | undefined> {
  if (!projectRootPath) return Promise.resolve(undefined)

  const key = statusCheckKey(projectRootPath)
  const existing = projectRootStatusChecks.get(key)
  if (existing) return existing

  const check = checkProjectRootStatus(projectRootPath)
  projectRootStatusChecks.set(key, check)
  void check.finally(() => {
    if (projectRootStatusChecks.get(key) === check) {
      projectRootStatusChecks.delete(key)
    }
  })
  return check
}
