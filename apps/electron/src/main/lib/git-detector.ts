/**
 * Git 运行时检测模块
 *
 * 负责检测系统中 Git 的可用性和获取 Git 仓库状态
 */

import { execFileAsync } from './async-command'
import { existsSync } from 'fs'
import { join } from 'path'
import type { GitRuntimeStatus, GitRepoStatus } from '@proma/shared'
import { getGitForWindowsInstallPath } from './windows-env'

async function findGitPath(): Promise<string | null> {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(command, ['git'], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    const result = typeof stdout === 'string' ? stdout : stdout.toString('utf-8')
    const gitPath = result.trim().split('\n')[0]

    if (gitPath && existsSync(gitPath)) {
      return gitPath
    }
  } catch {
    // Git 未安装
  }

  if (process.platform === 'win32') {
    const commonPaths: string[] = []
    const regInstallPath = await getGitForWindowsInstallPath()
    if (regInstallPath) {
      commonPaths.push(
        join(regInstallPath, 'cmd', 'git.exe'),
        join(regInstallPath, 'bin', 'git.exe'),
      )
    }

    const scoop = process.env.SCOOP
    const localAppData = process.env.LOCALAPPDATA
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'

    if (scoop) {
      commonPaths.push(
        join(scoop, 'apps', 'git', 'current', 'cmd', 'git.exe'),
        join(scoop, 'apps', 'git', 'current', 'bin', 'git.exe'),
        join(scoop, 'shims', 'git.exe'),
      )
    }
    if (localAppData) {
      commonPaths.push(
        join(localAppData, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
        join(localAppData, 'scoop', 'apps', 'git', 'current', 'bin', 'git.exe'),
      )
    }

    commonPaths.push(
      'C:\\ProgramData\\chocolatey\\bin\\git.exe',
      join(programFiles, 'Git', 'cmd', 'git.exe'),
      join(programFiles, 'Git', 'bin', 'git.exe'),
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    )

    for (const path of commonPaths) {
      if (existsSync(path)) return path
    }
  }

  return null
}

async function getGitVersion(gitPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(gitPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    const result = typeof stdout === 'string' ? stdout : stdout.toString('utf-8')
    if (result) {
      const match = result.match(/git version (\d+\.\d+\.\d+)/)
      return match ? match[1]! : result.trim()
    }
  } catch {
    // 执行失败
  }
  return null
}

export async function detectGitRuntime(): Promise<GitRuntimeStatus> {
  console.log('[Git 检测] 开始检测 Git 运行时...')
  const gitPath = await findGitPath()
  if (!gitPath) {
    console.warn('[Git 检测] 未找到 Git')
    return { available: false, version: null, path: null, error: '未找到 Git。请安装 Git 后重试。' }
  }

  const version = await getGitVersion(gitPath)
  if (!version) {
    console.warn(`[Git 检测] Git 无法执行: ${gitPath}`)
    return { available: false, version: null, path: gitPath, error: 'Git 已找到但无法执行' }
  }

  console.log(`[Git 检测] 找到 Git: ${gitPath} (${version})`)
  return { available: true, version, path: gitPath, error: null }
}

async function runGitCommand(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    const output = typeof stdout === 'string' ? stdout : stdout.toString('utf-8')
    return output.trim()
  } catch {
    // 命令执行失败
  }
  return null
}

export async function getGitRepoStatus(dirPath: string): Promise<GitRepoStatus | null> {
  if (!existsSync(dirPath)) return null

  const isRepo = await runGitCommand(['rev-parse', '--is-inside-work-tree'], dirPath)
  if (isRepo !== 'true') {
    return { isRepo: false, branch: null, hasChanges: false, remoteUrl: null }
  }

  const branch = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], dirPath)
  const status = await runGitCommand(['status', '--porcelain'], dirPath)
  const hasChanges = status !== null && status.length > 0
  const remoteUrl = await runGitCommand(['config', '--get', 'remote.origin.url'], dirPath)

  return { isRepo: true, branch: branch || null, hasChanges, remoteUrl: remoteUrl || null }
}

export async function detectGitBashWindows(): Promise<string | null> {
  if (process.platform !== 'win32') return null

  const commonPaths: string[] = []
  const regInstallPath = await getGitForWindowsInstallPath()
  if (regInstallPath) {
    commonPaths.push(join(regInstallPath, 'bin', 'bash.exe'), join(regInstallPath, 'usr', 'bin', 'bash.exe'))
  }

  const scoop = process.env.SCOOP
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  if (scoop) {
    commonPaths.push(
      join(scoop, 'apps', 'git', 'current', 'bin', 'bash.exe'),
      join(scoop, 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    )
  }
  if (localAppData) {
    commonPaths.push(
      join(localAppData, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
      join(localAppData, 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    )
  }
  commonPaths.push(
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
  )

  for (const path of commonPaths) {
    if (existsSync(path)) return path
  }

  try {
    const { stdout } = await execFileAsync('where', ['bash'], { encoding: 'utf-8', timeout: 5000 })
    const result = typeof stdout === 'string' ? stdout : stdout.toString('utf-8')
    const bashPath = result.trim().split('\n')[0]
    if (bashPath && existsSync(bashPath)) return bashPath
  } catch {
    // 未找到
  }
  return null
}
