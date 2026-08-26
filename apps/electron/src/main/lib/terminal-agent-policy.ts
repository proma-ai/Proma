import { existsSync, realpathSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

/**
 * 将 Agent 终端的初始 cwd 解析到会话已授权目录。该检查不是 OS sandbox：获得
 * 交互 shell 的用户仍拥有本机 shell 本身的文件访问能力，不能将 cwd 当作命令权限边界。
 */
export function resolveAgentTerminalCwd(input: {
  cwd?: string
  agentCwd?: string
  allowedRoots?: string[]
}): string {
  const fallback = input.agentCwd
  if (!fallback) throw new Error('当前 Agent 会话没有可用工作目录')
  const cwd = resolve(fallback, input.cwd || '.')
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error('终端工作目录不存在或不是目录')
  }

  // 比较规范真实路径，阻止将授权目录内、指向外部位置的 symlink 当作 cwd 传入。
  const realCwd = realpathSync(cwd)
  const roots = [...new Set([fallback, ...(input.allowedRoots ?? [])])]
    .filter((root) => existsSync(root) && statSync(root).isDirectory())
    .map((root) => realpathSync(root))
  if (!roots.some((root) => isPathWithin(realCwd, root))) {
    throw new Error('终端初始工作目录不在当前 Agent 会话的授权范围内')
  }
  return realCwd
}

export function isPathWithin(candidate: string, root: string): boolean {
  const path = resolve(candidate)
  const parent = resolve(root)
  const relation = relative(parent, path)
  return relation === '' || (!relation.startsWith('..') && !relation.includes(`${sep}..${sep}`) && !relation.startsWith(sep))
}
