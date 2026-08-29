import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { assertTerminalProfileSupported, type TerminalProfile } from '@proma/shared'

export interface ResolvedTerminalShell {
  file: string
  args: string[]
  title: string
}

export interface TerminalShellResolverOptions {
  platform?: string
  env?: NodeJS.ProcessEnv
  canExecute?: (path: string) => boolean
}

/**
 * Resolve the shell executable for a terminal profile.
 *
 * Platform eligibility and executable availability are both checked here, in
 * the utility process that creates the PTY. This is the final authority even
 * when a caller bypasses a higher-level tool schema.
 */
export function resolveTerminalShell(
  profile: TerminalProfile,
  options: TerminalShellResolverOptions = {},
): ResolvedTerminalShell {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const canExecute = options.canExecute ?? isExecutable
  assertTerminalProfileSupported(profile, platform)

  if (platform === 'win32') return resolveWindowsShell(profile, env, canExecute)
  return resolvePosixShell(profile, platform, env, canExecute)
}

function resolvePosixShell(
  profile: TerminalProfile,
  platform: string,
  env: NodeJS.ProcessEnv,
  canExecute: (path: string) => boolean,
): ResolvedTerminalShell {
  const fallback = platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  const shell = profile === 'default'
    ? resolveDefaultPosixShell(env.SHELL, fallback, canExecute)
    : profile === 'zsh'
      ? '/bin/zsh'
      : '/bin/bash'

  if (!canExecute(shell)) {
    throw new Error(`shell ${shell} 不存在或不可执行`)
  }
  return { file: shell, args: ['-l'], title: shell.split('/').pop() || 'Terminal' }
}

function resolveDefaultPosixShell(
  configuredShell: string | undefined,
  fallback: string,
  canExecute: (path: string) => boolean,
): string {
  if (configuredShell && canExecute(configuredShell)) return configuredShell
  return fallback
}

function resolveWindowsShell(
  profile: TerminalProfile,
  env: NodeJS.ProcessEnv,
  canExecute: (path: string) => boolean,
): ResolvedTerminalShell {
  const programFiles = env.ProgramFiles || 'C:\\Program Files'
  const gitBash = join(programFiles, 'Git', 'bin', 'bash.exe')
  const powershell = join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (profile === 'wsl') return { file: 'wsl.exe', args: [], title: 'WSL' }
  if (profile === 'git-bash') {
    if (!canExecute(gitBash)) throw new Error('Git Bash 不存在或不可执行')
    return { file: gitBash, args: ['--login', '-i'], title: 'Git Bash' }
  }
  if (profile === 'cmd') return { file: env.ComSpec || 'cmd.exe', args: [], title: 'Command Prompt' }
  if (profile === 'pwsh') return { file: 'pwsh.exe', args: ['-NoLogo'], title: 'PowerShell 7' }
  if (profile === 'powershell') {
    if (!canExecute(powershell)) throw new Error('Windows PowerShell 不存在或不可执行')
    return { file: powershell, args: ['-NoLogo'], title: 'Windows PowerShell' }
  }
  // 默认使用系统 Windows PowerShell；PowerShell 7、Git Bash 与 WSL 由 profile 显式选择。
  if (profile === 'default' && canExecute(powershell)) return { file: powershell, args: ['-NoLogo'], title: 'PowerShell' }
  if (profile === 'default') return { file: env.ComSpec || 'cmd.exe', args: [], title: 'Command Prompt' }
  return { file: env.ComSpec || 'cmd.exe', args: [], title: 'Command Prompt' }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
