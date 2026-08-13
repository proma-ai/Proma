import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { WINDOWS_AGENT_ISLAND_IPC_CHANNELS } from '../types'
import type { NativeAgentIslandSnapshot } from '@proma/shared'
import { calculateHoverWindowBounds } from './agent-status-hover-bounds'

const HOVER_WINDOW_WIDTH = 320

const SHOW_DELAY_MS = 300
const TRAY_LEAVE_GRACE_MS = 1500
const HOVER_LEAVE_HIDE_MS = 300

const HEADER_HEIGHT = 50
const ROW_HEIGHT = 72
const EMPTY_HEIGHT = 80
const MAX_HEIGHT = 600
const MAX_VISIBLE_SESSIONS = 10

function calculateHeight(sessionCount: number): number {
  if (sessionCount === 0) return EMPTY_HEIGHT
  const visible = Math.min(sessionCount, MAX_VISIBLE_SESSIONS)
  return Math.min(MAX_HEIGHT, HEADER_HEIGHT + visible * ROW_HEIGHT)
}

export class AgentStatusHoverWindow {
  private win: BrowserWindow | null = null
  private showTimer: ReturnType<typeof setTimeout> | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private latestSnapshot: NativeAgentIslandSnapshot | null = null
  private currentHeight = EMPTY_HEIGHT
  private hoverActive = false
  private lastTrayBounds: Electron.Rectangle | null = null

  ensureCreated(): void {
    if (this.win && !this.win.isDestroyed()) return

    this.win = new BrowserWindow({
      width: HOVER_WINDOW_WIDTH,
      height: this.currentHeight,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    this.win.on('closed', () => {
      this.win = null
    })

    this.win.on('blur', () => {
      this.scheduleHide()
    })

    if (app.isPackaged) {
      this.win.loadFile(join(__dirname, 'renderer', 'index.html'), {
        query: { window: 'agent-status-hover' },
      })
    } else {
      this.win.loadURL('http://127.0.0.1:5173?window=agent-status-hover')
    }
  }

  onTrayMouseEnter(bounds: Electron.Rectangle): void {
    this.clearHideTimer()

    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.pushSnapshot()
      return
    }

    this.clearShowTimer()
    this.showTimer = setTimeout(() => {
      this.showTimer = null
      this.show(bounds)
    }, SHOW_DELAY_MS)
  }

  onTrayMouseMove(bounds: Electron.Rectangle): void {
    this.clearHideTimer()

    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      return
    }

    if (!this.showTimer) {
      this.showTimer = setTimeout(() => {
        this.showTimer = null
        this.show(bounds)
      }, SHOW_DELAY_MS)
    }
  }

  onTrayMouseLeave(): void {
    if (this.hoverActive) return
    this.clearShowTimer()
    this.scheduleHide(TRAY_LEAVE_GRACE_MS)
  }

  onHoverMouseEnter(): void {
    this.hoverActive = true
    this.clearHideTimer()
  }

  onHoverMouseLeave(): void {
    this.hoverActive = false
    this.scheduleHide()
  }

  updateSnapshot(snapshot: NativeAgentIslandSnapshot): void {
    this.latestSnapshot = snapshot
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      if (snapshot.state.sessions.length === 0) {
        this.hide()
        return
      }
      this.resizeToFit(snapshot.state.sessions.length)
      this.win.webContents.send(WINDOWS_AGENT_ISLAND_IPC_CHANNELS.PUSH_SNAPSHOT, snapshot)
    }
  }

  dispose(): void {
    this.clearShowTimer()
    this.clearHideTimer()
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
    }
    this.win = null
  }

  private show(bounds: Electron.Rectangle): void {
    if (!this.latestSnapshot || this.latestSnapshot.state.sessions.length === 0) return
    if (!this.win || this.win.isDestroyed()) return

    this.lastTrayBounds = bounds
    this.resizeToFit(this.latestSnapshot.state.sessions.length)
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    const rect = calculateHoverWindowBounds(
      bounds,
      { width: HOVER_WINDOW_WIDTH, height: this.currentHeight },
      display,
    )
    this.win.setBounds(rect)
    this.win.showInactive()
    this.pushSnapshot()
  }

  private hide(): void {
    this.hoverActive = false
    if (this.win && !this.win.isDestroyed()) {
      this.win.hide()
    }
  }

  private scheduleHide(delay = HOVER_LEAVE_HIDE_MS): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.hide()
    }, delay)
  }

  private resizeToFit(sessionCount: number): void {
    const newHeight = calculateHeight(sessionCount)
    if (newHeight === this.currentHeight) return
    this.currentHeight = newHeight
    if (this.win && !this.win.isDestroyed() && this.win.isVisible() && this.lastTrayBounds) {
      const display = screen.getDisplayNearestPoint({
        x: this.lastTrayBounds.x,
        y: this.lastTrayBounds.y,
      })
      const rect = calculateHoverWindowBounds(
        this.lastTrayBounds,
        { width: HOVER_WINDOW_WIDTH, height: newHeight },
        display,
      )
      this.win.setBounds(rect)
    }
  }

  private pushSnapshot(): void {
    if (!this.win || this.win.isDestroyed() || !this.latestSnapshot) return
    if (this.win.webContents.isLoading()) {
      this.win.webContents.once('did-finish-load', () => {
        if (this.latestSnapshot) this.pushSnapshot()
      })
      return
    }
    this.win.webContents.send(WINDOWS_AGENT_ISLAND_IPC_CHANNELS.PUSH_SNAPSHOT, this.latestSnapshot)
  }

  private clearShowTimer(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer)
      this.showTimer = null
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }
}

let hoverWindow: AgentStatusHoverWindow | null = null

export function getAgentStatusHoverWindow(): AgentStatusHoverWindow {
  if (!hoverWindow) hoverWindow = new AgentStatusHoverWindow()
  return hoverWindow
}

export function destroyAgentStatusHoverWindow(): void {
  hoverWindow?.dispose()
  hoverWindow = null
}
