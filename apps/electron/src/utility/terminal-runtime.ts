import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import {
  isTerminalProfile,
  type TerminalCreateInput,
  type TerminalExitEvent,
  type TerminalInput,
  type TerminalOutputAck,
  type TerminalOutputEvent,
  type TerminalProfile,
  type TerminalResizeInput,
  type TerminalState,
} from '@proma/shared'

type MessagePortLike = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
  start(): void
  close(): void
}

type ParentPortLike = {
  on(event: 'message', listener: (event: { data: unknown; ports?: MessagePortLike[] }) => void): void
  start?: () => void
}

type RuntimeTerminalCreateInput = TerminalCreateInput & {
  strictCwd?: boolean
}

type RuntimeRequest =
  | { type: 'terminal.create'; input: RuntimeTerminalCreateInput }
  | { type: 'terminal.input'; input: TerminalInput }
  | { type: 'terminal.resize'; input: TerminalResizeInput }
  | { type: 'terminal.kill'; terminalId: string }
  | { type: 'terminal.ack-output'; input: TerminalOutputAck }
  | { type: 'terminal.shutdown' }

type InFlightOutput = {
  sequence: number
  data: string
}

type ManagedTerminal = {
  pty: IPty
  state: TerminalState
  output: string
  droppedOutputChars: number
  nextSequence: number
  inFlight: InFlightOutput | undefined
  flushTimer: ReturnType<typeof setTimeout> | undefined
  exitEvent: TerminalExitEvent | undefined
}

const MAX_PENDING_OUTPUT_CHARS = 1_000_000
const OUTPUT_FLUSH_DELAY_MS = 16
const terminals = new Map<string, ManagedTerminal>()
const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort
let runtimePort: MessagePortLike | undefined

if (!parentPort) {
  console.error('[TerminalRuntime] Electron parentPort is unavailable')
  process.exit(1)
}

parentPort.on('message', (event) => {
  const value = event?.data as Record<string, unknown> | undefined
  const transfer = value?.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : value
  if (!transfer || transfer.type !== 'proma-terminal-runtime-port') return
  const port = event.ports?.[0] ?? value?.port as MessagePortLike | undefined
  if (!port) {
    console.error('[TerminalRuntime] invalid MessagePort bootstrap message')
    process.exit(1)
  }
  runtimePort?.close()
  runtimePort = port
  port.on('message', (message) => handleRequest(message.data))
  port.start()
  port.postMessage({ type: 'terminal.ready', pid: process.pid })
})
parentPort.start?.()

function handleRequest(raw: unknown): void {
  if (!isRuntimeRequest(raw)) return
  switch (raw.type) {
    case 'terminal.create':
      createTerminal(raw.input)
      return
    case 'terminal.input':
      terminals.get(raw.input.terminalId)?.pty.write(raw.input.data)
      return
    case 'terminal.resize': {
      const terminal = terminals.get(raw.input.terminalId)
      if (terminal) terminal.pty.resize(normalizeDimension(raw.input.cols), normalizeDimension(raw.input.rows))
      return
    }
    case 'terminal.kill':
      destroyTerminal(raw.terminalId)
      return
    case 'terminal.ack-output':
      acknowledgeOutput(raw.input)
      return
    case 'terminal.shutdown':
      for (const terminalId of terminals.keys()) destroyTerminal(terminalId)
      runtimePort?.postMessage({ type: 'terminal.stopped' })
      return
  }
}

function createTerminal(input: RuntimeTerminalCreateInput): void {
  const existing = terminals.get(input.terminalId)
  if (existing) {
    runtimePort?.postMessage({ type: 'terminal.created', state: existing.state })
    return
  }
  const profile = isTerminalProfile(input.profile) ? input.profile : 'default'
  const shell = resolveShell(profile)
  try {
    const cwd = getSafeCwd(input.cwd, input.strictCwd === true)
    const pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: normalizeDimension(input.cols),
      rows: normalizeDimension(input.rows),
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    const state: TerminalState = {
      terminalId: input.terminalId,
      title: shell.title,
      cwd,
      profile,
      pid: pty.pid,
    }
    const managed: ManagedTerminal = {
      pty,
      state,
      output: '',
      droppedOutputChars: 0,
      nextSequence: 1,
      inFlight: undefined,
      flushTimer: undefined,
      exitEvent: undefined,
    }
    terminals.set(input.terminalId, managed)
    runtimePort?.postMessage({ type: 'terminal.created', state })
    pty.onData((data) => enqueueOutput(input.terminalId, data))
    pty.onExit(({ exitCode, signal }) => {
      const event: TerminalExitEvent = { terminalId: input.terminalId, exitCode, ...(signal === undefined ? {} : { signal }) }
      const terminal = terminals.get(input.terminalId)
      if (!terminal) {
        runtimePort?.postMessage({ type: 'terminal.exit', event })
        return
      }
      terminal.exitEvent = event
      flushOutput(input.terminalId)
      emitExitWhenDrained(input.terminalId)
    })
  } catch (error) {
    runtimePort?.postMessage({
      type: 'terminal.error',
      terminalId: input.terminalId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function enqueueOutput(terminalId: string, data: string): void {
  const terminal = terminals.get(terminalId)
  if (!terminal) return
  const remaining = MAX_PENDING_OUTPUT_CHARS - terminal.output.length
  if (remaining <= 0) {
    terminal.droppedOutputChars += data.length
    return
  }
  if (data.length > remaining) terminal.droppedOutputChars += data.length - remaining
  terminal.output += data.length > remaining ? data.slice(0, remaining) : data
  if (!terminal.flushTimer) {
    terminal.flushTimer = setTimeout(() => flushOutput(terminalId), OUTPUT_FLUSH_DELAY_MS)
  }
}

function flushOutput(terminalId: string): void {
  const terminal = terminals.get(terminalId)
  if (!terminal) return
  if (terminal.flushTimer) clearTimeout(terminal.flushTimer)
  terminal.flushTimer = undefined
  if (terminal.inFlight) return
  if (!terminal.output && terminal.droppedOutputChars === 0) return
  const lossMarker = terminal.droppedOutputChars > 0
    ? `\r\n\x1b[33m[Proma：终端输出过快，已丢弃 ${terminal.droppedOutputChars} 个字符]\x1b[0m\r\n`
    : ''
  const data = terminal.output + lossMarker
  terminal.output = ''
  terminal.droppedOutputChars = 0
  const sequence = terminal.nextSequence
  terminal.nextSequence += 1
  terminal.inFlight = { sequence, data }
  const event: TerminalOutputEvent = { terminalId, sequence, data }
  runtimePort?.postMessage({ type: 'terminal.output', event })
}

function acknowledgeOutput(input: TerminalOutputAck): void {
  const terminal = terminals.get(input.terminalId)
  if (!terminal?.inFlight || terminal.inFlight.sequence !== input.sequence) return
  terminal.inFlight = undefined
  flushOutput(input.terminalId)
  emitExitWhenDrained(input.terminalId)
}

function emitExitWhenDrained(terminalId: string): void {
  const terminal = terminals.get(terminalId)
  if (!terminal?.exitEvent || terminal.inFlight || terminal.output || terminal.droppedOutputChars > 0) return
  terminals.delete(terminalId)
  runtimePort?.postMessage({ type: 'terminal.exit', event: terminal.exitEvent })
}

function destroyTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId)
  if (!terminal) return
  flushOutput(terminalId)
  terminals.delete(terminalId)
  try {
    terminal.pty.kill()
  } catch {
    // 进程已退出时 node-pty 可能抛错；终端生命周期在此收束即可。
  }
}

function getSafeCwd(cwd: string | undefined, strict: boolean): string {
  if (isDirectory(cwd)) return cwd
  if (strict) throw new Error('终端工作目录不存在或不是目录')
  return homedir()
}

function isDirectory(path: string | undefined): path is string {
  if (!path || !existsSync(path)) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

function resolveShell(profile: TerminalProfile): { file: string; args: string[]; title: string } {
  if (process.platform === 'darwin') {
    const shell = profile === 'bash' ? '/bin/bash' : process.env.SHELL || '/bin/zsh'
    return { file: shell, args: ['-l'], title: shell.split('/').pop() || 'Terminal' }
  }
  if (process.platform === 'win32') return resolveWindowsShell(profile)
  const shell = profile === 'zsh' ? '/bin/zsh' : process.env.SHELL || '/bin/bash'
  return { file: shell, args: ['-l'], title: shell.split('/').pop() || 'Terminal' }
}

function resolveWindowsShell(profile: TerminalProfile): { file: string; args: string[]; title: string } {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const gitBash = join(programFiles, 'Git', 'bin', 'bash.exe')
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (profile === 'wsl') return { file: 'wsl.exe', args: [], title: 'WSL' }
  if (profile === 'git-bash' && existsSync(gitBash)) return { file: gitBash, args: ['--login', '-i'], title: 'Git Bash' }
  if (profile === 'cmd') return { file: process.env.ComSpec || 'cmd.exe', args: [], title: 'Command Prompt' }
  if (profile === 'pwsh' || profile === 'powershell') return { file: 'pwsh.exe', args: ['-NoLogo'], title: 'PowerShell' }
  // 默认使用系统 Windows PowerShell；PowerShell 7、Git Bash 与 WSL 由 profile 显式选择。
  if (profile === 'default' && existsSync(powershell)) return { file: powershell, args: ['-NoLogo'], title: 'PowerShell' }
  if (profile === 'default') return { file: process.env.ComSpec || 'cmd.exe', args: [], title: 'Command Prompt' }
  return { file: process.env.ComSpec || 'cmd.exe', args: [], title: 'Command Prompt' }
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as { type?: unknown }
  return request.type === 'terminal.create' || request.type === 'terminal.input' || request.type === 'terminal.resize' || request.type === 'terminal.kill' || request.type === 'terminal.ack-output' || request.type === 'terminal.shutdown'
}
