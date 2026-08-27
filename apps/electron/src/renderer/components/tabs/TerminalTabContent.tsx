import * as React from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { TerminalOutputEvent } from '@proma/shared'
import '@xterm/xterm/css/xterm.css'
import { detectIsWindows } from '@/lib/platform'

export interface TerminalTabContentProps {
  terminalId: string
  sessionId: string
  cwd?: string
  /** 右侧工作区切换 Agent 时由所属 Tab 的关闭动作统一终止 PTY。 */
  terminateOnUnmount?: boolean
}

/**
 * 每个 Terminal Tab 保有自己的 xterm 实例和滚动缓冲。父层仅切换 CSS visibility，
 * 因此切 Tab 不会销毁 PTY 或终端屏幕。
 */
export function TerminalTabContent({ terminalId, sessionId, cwd, terminateOnUnmount = true }: TerminalTabContentProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const terminalRef = React.useRef<Terminal>()
  const fitAddonRef = React.useRef<FitAddon>()
  const lastPtyDimensionsRef = React.useRef<{ cols: number; rows: number }>()
  // StrictMode 会模拟一次卸载再挂载；用单调 generation 区分真实关闭与这次重挂载。
  const lifecycleGenerationRef = React.useRef(0)

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const lifecycleGeneration = ++lifecycleGenerationRef.current
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5_000,
      windowsPty: detectIsWindows() ? { backend: 'conpty' } : undefined,
      theme: {
        background: '#111113',
        foreground: '#e6e6e9',
        cursor: '#e6e6e9',
        selectionBackground: '#3f3f46',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    let ptyCreated = false
    const fit = (): void => {
      try {
        // 不可见的 Tab 会得到 0×0；禁止把 PTY 缩成 FitAddon 的最小 2×1，
        // 否则 Windows ConPTY 会重排屏幕并让交互光标跳动。
        if (host.clientWidth <= 0 || host.clientHeight <= 0 || host.offsetParent === null) return

        fitAddon.fit()
        const { cols, rows } = terminal
        const previous = lastPtyDimensionsRef.current
        if (ptyCreated && cols > 0 && rows > 0 && (previous?.cols !== cols || previous.rows !== rows)) {
          lastPtyDimensionsRef.current = { cols, rows }
          void window.electronAPI.resizeTerminal({ terminalId, cols, rows }).catch(console.error)
        }
      } catch {
        // 终端字体尚未完成测量时忽略；下一次布局变化会再次尝试。
      }
    }
    const resizeObserver = new ResizeObserver(fit)
    resizeObserver.observe(host)
    // 同步完成首帧测量，创建 PTY 时直接使用真实行列，避免 Windows 首次 80×24 → 实际尺寸的重排。
    fit()
    requestAnimationFrame(fit)

    let disposed = false
    let restoring = true
    let lastRenderedSequence = 0
    const pendingOutput: TerminalOutputEvent[] = []
    const acknowledge = (sequence: number): void => {
      if (sequence > 0) window.electronAPI.acknowledgeTerminalOutput({ terminalId, sequence })
    }
    const renderOutput = (event: TerminalOutputEvent): void => {
      if (event.sequence <= lastRenderedSequence) {
        acknowledge(event.sequence)
        return
      }
      terminal.write(event.data, () => {
        if (disposed) return
        lastRenderedSequence = event.sequence
        acknowledge(event.sequence)
      })
    }
    const flushPendingOutput = (): void => {
      pendingOutput.sort((left, right) => left.sequence - right.sequence)
      for (const event of pendingOutput.splice(0)) renderOutput(event)
    }

    const disposeInput = terminal.onData((data) => {
      void window.electronAPI.writeTerminal({ terminalId, data }).catch(console.error)
    })
    const disposeOutput = window.electronAPI.onTerminalOutput((event) => {
      if (event.terminalId !== terminalId) return
      if (restoring) pendingOutput.push(event)
      else renderOutput(event)
    })
    const disposeExit = window.electronAPI.onTerminalExit((event) => {
      if (event.terminalId === terminalId) terminal.write(`\r\n\x1b[90m终端已退出（${event.exitCode}）\x1b[0m\r\n`)
    })

    let creation: Promise<unknown> | undefined
    const create = async (): Promise<void> => {
      try {
        const initialCols = Math.max(terminal.cols, 1)
        const initialRows = Math.max(terminal.rows, 1)
        lastPtyDimensionsRef.current = { cols: initialCols, rows: initialRows }
        creation = window.electronAPI.createTerminal({
          terminalId,
          sessionId,
          cwd,
          cols: initialCols,
          rows: initialRows,
        })
        await creation
        if (disposed) return
        ptyCreated = true
        fit()
        const snapshot = await window.electronAPI.getTerminalSnapshot(terminalId)
        terminal.write(snapshot.output, () => {
          if (disposed) return
          lastRenderedSequence = snapshot.sequence
          acknowledge(snapshot.sequence)
          restoring = false
          flushPendingOutput()
          terminal.focus()
        })
      } catch (error) {
        if (disposed) return
        restoring = false
        terminal.write(`\r\n\x1b[31m无法启动终端：${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`)
      }
    }
    void create()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      disposeInput.dispose()
      disposeOutput()
      disposeExit()
      terminal.dispose()
      terminalRef.current = undefined
      fitAddonRef.current = undefined
      if (terminateOnUnmount) {
        const killIfStillUnmounted = (): void => {
          if (lifecycleGenerationRef.current === lifecycleGeneration) {
            void window.electronAPI.killTerminal(terminalId).catch(console.error)
          }
        }
        // If creation is still pending, wait until it settles so the main process can
        // cancel the newly created PTY instead of leaking it during a real unmount.
        if (creation) void creation.then(killIfStillUnmounted, killIfStillUnmounted)
        else killIfStillUnmounted()
      }
    }
  }, [cwd, sessionId, terminalId, terminateOnUnmount])

  return (
    <div className="h-full w-full overflow-hidden bg-[#111113] p-2">
      <div ref={hostRef} className="h-full min-h-0 w-full min-w-0" />
    </div>
  )
}
