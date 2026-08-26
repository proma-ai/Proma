import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * 普通终端可由用户在目录被移除后再次打开。此时保留可用的终端体验，
 * 而不是将失效的历史 cwd 传给 PTY。Agent 终端仍在 terminal-agent-policy 中
 * 执行单独的授权范围校验。
 */
export function resolveTerminalCwd(cwd: string | undefined, fallback = homedir()): string {
  return isDirectory(cwd) ? cwd : fallback
}

function isDirectory(path: string | undefined): path is string {
  if (!path || !existsSync(path)) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
