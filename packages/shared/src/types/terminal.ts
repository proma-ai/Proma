/**
 * 本地终端 Tab 的跨进程数据契约。
 *
 * Renderer 只能传递 profile/cwd/尺寸和终端输入，不能指定任意可执行文件，
 * 具体 shell 始终在受控的 Terminal Runtime 中解析。
 */

export const TERMINAL_IPC_CHANNELS = {
  CREATE: 'terminal:create',
  INPUT: 'terminal:input',
  RESIZE: 'terminal:resize',
  KILL: 'terminal:kill',
  SNAPSHOT: 'terminal:snapshot',
  ACK_OUTPUT: 'terminal:ack-output',
  AGENT_OPEN: 'terminal:agent-open',
  AGENT_CLOSE: 'terminal:agent-close',
  OUTPUT: 'terminal:output',
  EXIT: 'terminal:exit',
} as const

export type TerminalProfile = 'default' | 'zsh' | 'bash' | 'pwsh' | 'powershell' | 'cmd' | 'git-bash' | 'wsl'

const POSIX_TERMINAL_PROFILES = ['default', 'zsh', 'bash'] as const satisfies readonly TerminalProfile[]
const WINDOWS_TERMINAL_PROFILES = ['default', 'pwsh', 'powershell', 'cmd', 'git-bash', 'wsl'] as const satisfies readonly TerminalProfile[]

/** 返回当前平台允许请求的终端 profile；实际可执行性仍由 Terminal Runtime 在创建 PTY 时校验。 */
export function getTerminalProfilesForPlatform(platform: string): readonly TerminalProfile[] {
  if (platform === 'win32') return WINDOWS_TERMINAL_PROFILES
  if (platform === 'darwin' || platform === 'linux') return POSIX_TERMINAL_PROFILES
  return ['default']
}

/** 防止 profile 在不支持它的平台上静默解析为另一个 shell。 */
export function assertTerminalProfileSupported(profile: TerminalProfile, platform: string): TerminalProfile {
  if (getTerminalProfilesForPlatform(platform).includes(profile)) return profile
  throw new Error(`shell ${profile} 不支持当前平台 ${platform}；可选值：${getTerminalProfilesForPlatform(platform).join('、')}`)
}

export interface TerminalCreateInput {
  terminalId: string
  /** 终端所属 Agent 会话；主进程据此在会话删除时回收 PTY。 */
  sessionId: string
  cwd?: string
  profile?: TerminalProfile
  cols: number
  rows: number
}

export interface TerminalInput {
  terminalId: string
  data: string
}

export interface TerminalResizeInput {
  terminalId: string
  cols: number
  rows: number
}

export interface TerminalState {
  terminalId: string
  title: string
  cwd: string
  profile: TerminalProfile
  pid: number
}

export interface TerminalOutputEvent {
  terminalId: string
  /** 单终端单调递增，用于重连去重与 ACK。 */
  sequence: number
  data: string
}

export interface TerminalOutputAck {
  terminalId: string
  sequence: number
}

/**
 * 终端视图重挂载时的受控恢复材料。output 是有限滚动缓冲，sequence 表示其末尾。
 */
export interface TerminalSnapshot {
  state: TerminalState
  output: string
  sequence: number
}

/** 主进程通知 Renderer：Agent 已创建一个应呈现在其右侧工作区的终端。 */
export interface AgentTerminalOpenEvent {
  sessionId: string
  terminalId: string
  title: string
  cwd: string
  profile?: TerminalProfile
}

export interface AgentTerminalCloseEvent {
  sessionId: string
  terminalId: string
}

export interface TerminalExitEvent {
  terminalId: string
  exitCode: number
  signal?: number
}

export function isTerminalProfile(value: unknown): value is TerminalProfile {
  return value === 'default'
    || value === 'zsh'
    || value === 'bash'
    || value === 'pwsh'
    || value === 'powershell'
    || value === 'cmd'
    || value === 'git-bash'
    || value === 'wsl'
}

/**
 * 把外部输入（如 Agent 工具参数）解析为 TerminalProfile。
 * 省略或空串回退到 default；显式传入未知值时抛错而非静默回退，
 * 避免调用方误以为终端运行在指定 shell 上。
 */
export function parseTerminalProfile(value: unknown): TerminalProfile {
  if (value === undefined || value === null || value === '') return 'default'
  if (isTerminalProfile(value)) return value
  throw new Error(`shell 无效：${String(value)}。可选值：default、pwsh、powershell、cmd、git-bash、wsl、bash、zsh`)
}
