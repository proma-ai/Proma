import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

/**
 * 将 Agent 工具报告的文件路径解析到该会话实际运行的 cwd。
 *
 * Write/Edit 可接受相对路径；它们相对于 Agent cwd（项目目录或活动 worktree），
 * 未归属项目的会话则与 Agent 启动逻辑一致，回退到用户主目录。
 */
export function resolvePathAgainstAgentCwd(filePath: string, agentCwd?: string): string {
  return isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(agentCwd ?? homedir(), filePath)
}
