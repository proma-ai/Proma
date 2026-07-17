import { existsSync } from 'node:fs'
import { delimiter, dirname, join, win32 } from 'node:path'
import type { RuntimeStatus } from '@proma/shared'
import { getBundledCliPath } from './config-paths'

export type AgentRuntimeShellKind = 'git-bash' | 'wsl'

export interface AgentRuntimeEnv {
  env: Record<string, string>
  shellKind?: AgentRuntimeShellKind
  shellPath?: string
  wslCommand?: string
  wslDistro?: string
}

export interface BuildAgentRuntimeEnvOptions {
  proxyUrl?: string
  runtimeStatus?: RuntimeStatus | null
  bundledCliPath?: string
  processEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  pathDelimiter?: string
  pathExists?: (path: string) => boolean
}

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'] as const
const CASE_INSENSITIVE_MERGE_KEYS = new Set([
  'path',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'proma_cli',
  'claude_code_shell',
  'shell',
  'proma_windows_shell',
  'proma_wsl_distro',
])

function getCaseInsensitiveEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const exact = env[key]
  if (exact) return exact
  const foundKey = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())
  const value = foundKey ? env[foundKey] : undefined
  return value || undefined
}

function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
}

function hasPathEntry(entries: string[], entry: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    const normalizedEntry = entry.toLowerCase()
    return entries.some((item) => item.toLowerCase() === normalizedEntry)
  }
  return entries.includes(entry)
}

function prependPathEntry(
  currentPath: string | undefined,
  entry: string | undefined,
  pathDelimiter: string,
  platform: NodeJS.Platform,
): string | undefined {
  const entries = (currentPath ?? '').split(pathDelimiter).filter(Boolean)
  if (!entry) return entries.join(pathDelimiter) || undefined
  if (hasPathEntry(entries, entry, platform)) return entries.join(pathDelimiter) || entry
  return [entry, ...entries].join(pathDelimiter)
}

function dirnameForPlatform(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? win32.dirname(path) : dirname(path)
}

function collectProxyEnv(proxyUrl: string | undefined, processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  const trimmedProxyUrl = proxyUrl?.trim()
  const setProxyEnv = (key: string, value: string): void => {
    env[key] = value
    env[key.toLowerCase()] = value
  }

  if (trimmedProxyUrl) {
    for (const key of PROXY_ENV_KEYS) {
      setProxyEnv(key, trimmedProxyUrl)
    }
  } else {
    for (const key of PROXY_ENV_KEYS) {
      const value = getCaseInsensitiveEnvValue(processEnv, key)
      if (value) setProxyEnv(key, value)
    }
  }

  const noProxy = getCaseInsensitiveEnvValue(processEnv, 'NO_PROXY')
  if (noProxy) setProxyEnv('NO_PROXY', noProxy)

  return env
}

function getWslCommandPath(
  processEnv: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): string {
  const systemRoot = processEnv.SystemRoot ?? processEnv.SYSTEMROOT ?? processEnv.windir ?? processEnv.WINDIR
  const candidates = systemRoot
    ? [
        join(systemRoot, 'System32', 'wsl.exe'),
        join(systemRoot, 'Sysnative', 'wsl.exe'),
      ]
    : []

  return candidates.find(pathExists) ?? 'wsl.exe'
}

function collectWindowsShellEnv(
  runtimeStatus: RuntimeStatus | null | undefined,
  processEnv: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): Omit<AgentRuntimeEnv, 'env'> & { env: Record<string, string> } {
  const shellStatus = runtimeStatus?.shell
  const env: Record<string, string> = {}

  if (shellStatus?.gitBash.available && shellStatus.gitBash.path) {
    const shellPath = shellStatus.gitBash.path
    env.PROMA_WINDOWS_SHELL = 'git-bash'
    env.CLAUDE_CODE_SHELL = shellPath
    env.SHELL = shellPath
    return {
      env,
      shellKind: 'git-bash',
      shellPath,
    }
  }

  if (shellStatus?.wsl.available) {
    const wslCommand = getWslCommandPath(processEnv, pathExists)
    env.PROMA_WINDOWS_SHELL = 'wsl'
    env.CLAUDE_CODE_SHELL = wslCommand
    env.SHELL = wslCommand
    if (shellStatus.wsl.defaultDistro) {
      env.PROMA_WSL_DISTRO = shellStatus.wsl.defaultDistro
    }
    return {
      env,
      shellKind: 'wsl',
      wslCommand,
      ...(shellStatus.wsl.defaultDistro && { wslDistro: shellStatus.wsl.defaultDistro }),
    }
  }

  return { env }
}

export function mergeRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
  overrideEnv: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {}
  const overrideLowerKeys = new Set(Object.keys(overrideEnv ?? {}).map((key) => key.toLowerCase()))

  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (value !== undefined) merged[key] = value
  }

  for (const existingKey of Object.keys(merged)) {
    const lowerKey = existingKey.toLowerCase()
    if (overrideLowerKeys.has(lowerKey) && CASE_INSENSITIVE_MERGE_KEYS.has(lowerKey)) {
      delete merged[existingKey]
    }
  }

  for (const [key, value] of Object.entries(overrideEnv ?? {})) {
    if (value === undefined) continue
    merged[key] = value
  }

  return merged
}

export function buildAgentRuntimeEnv(options: BuildAgentRuntimeEnvOptions = {}): AgentRuntimeEnv {
  const processEnv = options.processEnv ?? process.env
  const platform = options.platform ?? process.platform
  const pathDelimiter = options.pathDelimiter ?? delimiter
  const pathExists = options.pathExists ?? existsSync
  const bundledCliPath = options.bundledCliPath ?? getBundledCliPath()
  const env: Record<string, string> = {}

  if (bundledCliPath) {
    env.PROMA_CLI = bundledCliPath
  }

  const pathKey = getPathKey(processEnv)
  const enhancedPath = prependPathEntry(
    processEnv[pathKey],
    bundledCliPath ? dirnameForPlatform(bundledCliPath, platform) : undefined,
    pathDelimiter,
    platform,
  )
  if (enhancedPath) {
    env[pathKey] = enhancedPath
  }

  Object.assign(env, collectProxyEnv(options.proxyUrl, processEnv))

  if (platform === 'win32') {
    const shellRuntimeEnv = collectWindowsShellEnv(options.runtimeStatus, processEnv, pathExists)
    Object.assign(env, shellRuntimeEnv.env)
    return {
      env,
      ...(shellRuntimeEnv.shellKind && { shellKind: shellRuntimeEnv.shellKind }),
      ...(shellRuntimeEnv.shellPath && { shellPath: shellRuntimeEnv.shellPath }),
      ...(shellRuntimeEnv.wslCommand && { wslCommand: shellRuntimeEnv.wslCommand }),
      ...(shellRuntimeEnv.wslDistro && { wslDistro: shellRuntimeEnv.wslDistro }),
    }
  }

  return { env }
}
