import type { ShellEnvironmentStatus, WindowsShellPreference } from '@proma/shared'

export type WindowsShellKind = 'git-bash' | 'wsl'

/**
 * 解析 Windows Agent Shell。
 *
 * 默认策略优先 Git Bash，确保 Electron、工作区与 Bash 工具都使用 Windows 路径；
 * WSL 仅在用户明确选择时启用。任何首选项不可用时，都会安全回退到另一可用 Shell。
 */
export function selectWindowsShell(
  shellStatus: Pick<ShellEnvironmentStatus, 'gitBash' | 'wsl'> | null | undefined,
  preference: WindowsShellPreference = 'auto',
): WindowsShellKind | null {
  const hasGitBash = Boolean(shellStatus?.gitBash.available && shellStatus.gitBash.path)
  const hasWsl = Boolean(shellStatus?.wsl.available)

  if (preference === 'wsl' && hasWsl) return 'wsl'
  if (preference === 'git-bash' && hasGitBash) return 'git-bash'
  if (hasGitBash) return 'git-bash'
  if (hasWsl) return 'wsl'
  return null
}
