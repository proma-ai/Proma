import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

/**
 * 展开 shell 风格的用户目录缩写。
 *
 * Node 的 path API 不会处理 `~`；只识别当前用户的 `~`、`~/…` 与 `~\\…`，
 * 不支持也不会猜测 `~other-user`。后续调用方仍须完成自身的授权校验。
 */
export function expandHomeDirectory(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return resolve(homedir(), ...filePath.slice(2).split(/[\\/]+/))
  }
  return filePath
}

/**
 * 将 Agent 工具报告的文件路径解析到该会话实际运行的 cwd。
 *
 * 支持 shell 风格的 `~` 用户目录缩写。其他相对路径仍相对于 Agent cwd（项目目录或
 * 活动 worktree）；未归属项目的会话则与 Agent 启动逻辑一致，回退到用户主目录。
 */
export function resolvePathAgainstAgentCwd(filePath: string, agentCwd?: string): string {
  const expandedPath = expandHomeDirectory(filePath)
  return isAbsolute(expandedPath)
    ? resolve(expandedPath)
    : resolve(agentCwd ?? homedir(), expandedPath)
}
