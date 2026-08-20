import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  CuaDriverDetectedTool,
  CuaDriverDetectionResult,
  CuaDriverRuntimeSource,
} from '@proma/shared'
import { getSettings } from './settings-service'

export const DEFAULT_CUA_DRIVER_COMMAND = 'cua-driver'
const VERSION_TIMEOUT_MS = 10_000
const DETECT_TIMEOUT_MS = 15_000
const CUA_DRIVER_EXECUTABLE_NAME = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
const REQUIRED_TOOL_NAMES = new Set(['list_windows', 'get_window_state', 'click', 'type_text'])

type CuaDriverJson = Record<string, unknown>

interface CuaDriverRuntimeResolution {
  path: string
  source: CuaDriverRuntimeSource
  checkedPaths: string[]
}

interface DetectionProcessResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function objectValue(value: unknown): CuaDriverJson {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as CuaDriverJson : {}
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))]
}

function resourcesPath(): string | undefined {
  const value = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return typeof value === 'string' && value ? value : undefined
}

function runtimePlatformKey(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `${platform}-${arch}`
}

function bundledCuaDriverCandidates(): string[] {
  const candidates: string[] = []
  const platformKey = runtimePlatformKey()
  const packagedResources = resourcesPath()
  if (packagedResources) {
    candidates.push(
      join(packagedResources, 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
      join(packagedResources, 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    )
  }

  candidates.push(
    resolve(__dirname, 'resources', 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
    resolve(__dirname, 'resources', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    resolve(__dirname, '..', 'resources', 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
    resolve(__dirname, '..', 'resources', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    resolve(__dirname, '..', '..', '..', 'resources', 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
    resolve(__dirname, '..', '..', '..', 'resources', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'dist', 'resources', 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'dist', 'resources', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'resources', 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'resources', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'apps', 'electron', 'dist', 'resources', 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'apps', 'electron', 'dist', 'resources', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'apps', 'electron', 'resources', 'bin', 'cua-driver', platformKey, CUA_DRIVER_EXECUTABLE_NAME),
    resolve(process.cwd(), 'apps', 'electron', 'resources', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
  )

  return uniquePaths(candidates)
}

function configuredCuaDriverPath(): string | undefined {
  const configured = getSettings().desktopAutomation?.cuaDriver?.path?.trim()
  return configured && configured !== DEFAULT_CUA_DRIVER_COMMAND ? configured : undefined
}

export function resolveCuaDriverRuntimePath(): CuaDriverRuntimeResolution {
  const checkedPaths: string[] = []
  const envPath = process.env.PROMA_CUA_DRIVER_PATH?.trim() || process.env.PROMA_CUA_PATH?.trim()
  if (envPath) return { path: envPath, source: 'env', checkedPaths }

  const configured = configuredCuaDriverPath()
  if (configured) return { path: configured, source: 'configured', checkedPaths }

  for (const candidate of bundledCuaDriverCandidates()) {
    checkedPaths.push(candidate)
    if (existsSync(candidate)) return { path: candidate, source: 'bundled', checkedPaths }
  }

  const userLocalCandidates = uniquePaths([
    join(homedir(), '.local', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
    join(homedir(), '.cua', 'bin', CUA_DRIVER_EXECUTABLE_NAME),
  ])
  for (const candidate of userLocalCandidates) {
    checkedPaths.push(candidate)
    if (existsSync(candidate)) return { path: candidate, source: 'user-local', checkedPaths }
  }

  return { path: DEFAULT_CUA_DRIVER_COMMAND, source: 'path', checkedPaths }
}

export function resolveCuaDriverMcpServerConfig(runtimeEnv?: Record<string, string>): Record<string, unknown> {
  const resolution = resolveCuaDriverRuntimePath()
  const startupTimeoutSec = getSettings().desktopAutomation?.cuaDriver?.startupTimeoutSec ?? 15
  return {
    type: 'stdio',
    command: resolution.path,
    args: ['mcp'],
    required: true,
    startup_timeout_sec: startupTimeoutSec,
    timeout: 120,
    stderr: 'ignore',
    env: {
      ...(process.env.PATH && { PATH: process.env.PATH }),
      ...(process.env.HOME && { HOME: process.env.HOME }),
      ...(process.env.USERPROFILE && { USERPROFILE: process.env.USERPROFILE }),
      ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
      ...(process.env.TEMP && { TEMP: process.env.TEMP }),
      ...(process.env.TMP && { TMP: process.env.TMP }),
      ...getProxyEnv(runtimeEnv),
    },
    tool_allowlist: [
      'start_session',
      'end_session',
      'list_sessions',
      'get_session',
      'check_permissions',
      'health_report',
      'get_desktop_state',
      'get_accessibility_tree',
      'get_window_state',
      'get_screen_size',
      'get_cursor_position',
      'list_windows',
      'debug_window_info',
      'list_apps',
      'launch_app',
      'bring_to_front',
      'click',
      'double_click',
      'right_click',
      'scroll',
      'drag',
      'move_cursor',
      'type_text',
      'press_key',
      'hotkey',
      'set_value',
      'invoke_menu',
      'set_window_frame',
      'zoom',
      'verify_state',
    ],
  }
}

const PROXY_ENV_KEYS = new Set([
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
])

function getProxyEnv(runtimeEnv?: Record<string, string>): Record<string, string> {
  if (!runtimeEnv) return {}
  return Object.fromEntries(
    Object.entries(runtimeEnv).filter(([key]) => PROXY_ENV_KEYS.has(key)),
  )
}

function processErrorMessage(result: DetectionProcessResult, label: string): string {
  if (result.error) return result.error
  if (result.timedOut) return `${label} 超时`
  return result.stderr.trim() || result.stdout.trim() || `${label} 退出码 ${result.code ?? 'unknown'}`
}

function runCuaDriverDetectionProcess(path: string, args: string[], timeoutMs: number): Promise<DetectionProcessResult> {
  return new Promise<DetectionProcessResult>((resolveResult) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(path, args, { windowsHide: true })
    } catch (error) {
      resolveResult({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timeout: NodeJS.Timeout
    let forceResolveTimer: NodeJS.Timeout | undefined

    const finish = (result: DetectionProcessResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceResolveTimer) clearTimeout(forceResolveTimer)
      resolveResult(result)
    }

    timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceResolveTimer = setTimeout(() => {
        finish({ code: null, stdout, stderr, timedOut: true })
      }, 2_000)
      forceResolveTimer.unref?.()
    }, timeoutMs)
    timeout.unref?.()

    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        error: error.message,
      })
    })
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut })
    })
  })
}

function parseCuaDriverVersion(text: string): string | undefined {
  return text.trim().match(/cua-driver\s+([^\s]+)/i)?.[1] ?? (text.trim() || undefined)
}

function parseCuaDriverTools(text: string): CuaDriverDetectedTool[] {
  const tools: CuaDriverDetectedTool[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([a-z][a-z0-9_]*):\s*(.*)$/)
    if (!match) continue
    const name = match[1]
    if (!name) continue
    tools.push({ name, description: match[2]?.trim() || undefined })
  }
  return tools
}

function parseJson(text: string): CuaDriverJson | undefined {
  try {
    return JSON.parse(text.trim()) as CuaDriverJson
  } catch {
    return undefined
  }
}

export async function detectCuaDriverRuntime(): Promise<CuaDriverDetectionResult> {
  const resolution = resolveCuaDriverRuntimePath()
  const hints: string[] = []

  const versionResult = await runCuaDriverDetectionProcess(resolution.path, ['--version'], VERSION_TIMEOUT_MS)
  if (versionResult.code !== 0 || versionResult.timedOut || versionResult.error) {
    const error = processErrorMessage(versionResult, 'cua-driver --version')
    hints.push('未检测到可用的 cua-driver。留空路径时会优先使用 Proma 内置版本；也可以手动填写 cua-driver 的绝对路径。')
    if (resolution.checkedPaths.length > 0) {
      hints.push(`已尝试自动查找：${resolution.checkedPaths.join('、')}`)
    }
    return {
      ok: false,
      checkedAt: Date.now(),
      cli: { ok: false, path: resolution.path, source: resolution.source, error },
      manifest: { ok: false },
      mcp: { ok: false, toolCount: 0, tools: [] },
      hints,
    }
  }

  const version = parseCuaDriverVersion(versionResult.stdout)
  const manifestResult = await runCuaDriverDetectionProcess(resolution.path, ['manifest'], DETECT_TIMEOUT_MS)
  const manifest = manifestResult.code === 0 && !manifestResult.timedOut && !manifestResult.error
    ? parseJson(manifestResult.stdout)
    : undefined
  const mcpInvocation = objectValue(manifest?.mcp_invocation)
  const mcpArgs = arrayValue(mcpInvocation.args).filter((arg): arg is string => typeof arg === 'string')

  const listToolsResult = await runCuaDriverDetectionProcess(resolution.path, ['list-tools'], DETECT_TIMEOUT_MS)
  if (listToolsResult.code !== 0 || listToolsResult.timedOut || listToolsResult.error) {
    const error = processErrorMessage(listToolsResult, 'cua-driver list-tools')
    hints.push('cua-driver 可以运行，但无法列出 MCP 工具。请在终端执行 cua-driver doctor 查看详细原因。')
    return {
      ok: false,
      checkedAt: Date.now(),
      cli: { ok: true, path: resolution.path, source: resolution.source, version },
      manifest: {
        ok: Boolean(manifest),
        mcpCommand: stringValue(mcpInvocation.command),
        mcpArgs,
        error: manifest ? undefined : processErrorMessage(manifestResult, 'cua-driver manifest'),
      },
      mcp: { ok: false, toolCount: 0, tools: [], error },
      hints,
    }
  }

  const tools = parseCuaDriverTools(listToolsResult.stdout)
  const toolNames = new Set(tools.map((tool) => tool.name))
  const missingRequiredTools = [...REQUIRED_TOOL_NAMES].filter((tool) => !toolNames.has(tool))
  if (missingRequiredTools.length > 0) {
    hints.push(`cua-driver 工具面不完整，缺少：${missingRequiredTools.join('、')}。请升级 cua-driver。`)
  }
  if (process.platform === 'darwin') {
    hints.push('macOS 首次使用桌面控制时需要在系统设置里授予辅助功能和屏幕录制权限。')
  }

  const ok = tools.length > 0 && missingRequiredTools.length === 0
  return {
    ok,
    checkedAt: Date.now(),
    cli: { ok: true, path: resolution.path, source: resolution.source, version },
    manifest: {
      ok: Boolean(manifest),
      mcpCommand: stringValue(mcpInvocation.command),
      mcpArgs,
      error: manifest ? undefined : processErrorMessage(manifestResult, 'cua-driver manifest'),
    },
    mcp: {
      ok,
      toolCount: tools.length,
      tools,
      error: ok ? undefined : 'MCP 工具面不完整',
    },
    hints,
  }
}
