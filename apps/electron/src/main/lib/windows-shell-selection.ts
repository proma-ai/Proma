import type { ShellEnvironmentStatus } from '@proma/shared'

export type WindowsShellKind = 'git-bash' | 'wsl'

export function selectWindowsShell(
  shellStatus: Pick<ShellEnvironmentStatus, 'gitBash' | 'wsl'> | null | undefined,
): WindowsShellKind | null {
  if (shellStatus?.wsl.available) return 'wsl'
  if (shellStatus?.gitBash.available && shellStatus.gitBash.path) return 'git-bash'
  return null
}
