/**
 * 语音输入浮窗管理
 *
 * 独立于快速任务窗口，专注系统级语音听写。
 */

import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import { captureVoiceDictationTarget } from './text-output-service'

let voiceDictationWindow: BrowserWindow | null = null
let voiceDictationTargetIsProma = false
let voiceDictationTargetCaptured = false
let suppressMainWindowActivateUntil = 0

const WINDOW_WIDTH = 480
const WINDOW_HEIGHT = 160
const MIN_WINDOW_HEIGHT = 148
const WINDOW_MARGIN = 12
const ACTIVATE_SUPPRESSION_MS = 1800

interface VoiceDictationToggleOptions {
  targetIsProma?: boolean
}

export function createVoiceDictationWindow(): void {
  if (voiceDictationWindow && !voiceDictationWindow.isDestroyed()) return

  voiceDictationWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    show: false,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const isDev = !app.isPackaged
  if (isDev) {
    voiceDictationWindow.loadURL('http://localhost:5173?window=voice-dictation')
  } else {
    voiceDictationWindow.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'voice-dictation' },
    })
  }

  voiceDictationWindow.on('closed', () => {
    voiceDictationWindow = null
  })

  console.log('[语音输入] 浮窗预创建完成')
}

export function toggleVoiceDictationWindow(options: VoiceDictationToggleOptions = {}): void {
  if (!voiceDictationWindow || voiceDictationWindow.isDestroyed()) {
    captureTargetForNextSession(options.targetIsProma)
    createVoiceDictationWindow()
    voiceDictationWindow?.once('ready-to-show', () => {
      positionAndShow()
    })
    return
  }

  if (voiceDictationWindow.isVisible()) {
    voiceDictationWindow.webContents.send(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP)
  } else {
    captureTargetForNextSession(options.targetIsProma)
    positionAndShow()
  }
}

function captureTargetForNextSession(targetIsProma?: boolean): void {
  voiceDictationTargetIsProma = captureVoiceDictationTarget(targetIsProma)
  voiceDictationTargetCaptured = true
}

function positionAndShow(): void {
  if (!voiceDictationWindow || voiceDictationWindow.isDestroyed()) return

  if (!voiceDictationTargetCaptured) {
    captureTargetForNextSession()
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x, y, width, height } = display.workArea

  voiceDictationWindow.setBounds({
    x: Math.round(x + (width - WINDOW_WIDTH) / 2),
    y: Math.round(y + height * 0.28),
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })

  // 语音浮窗只是系统级提示层，不应抢焦点或改变 Proma 主窗口前后台状态。
  voiceDictationWindow.showInactive()
  voiceDictationWindow.webContents.send(VOICE_DICTATION_IPC_CHANNELS.SHOWN)
}

export function resizeVoiceDictationWindow(height: number): void {
  if (!voiceDictationWindow || voiceDictationWindow.isDestroyed()) return
  const bounds = voiceDictationWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, display.workArea.height - WINDOW_MARGIN * 2)
  const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Math.min(maxHeight, Math.round(height)))
  const maxY = display.workArea.y + display.workArea.height - nextHeight - WINDOW_MARGIN
  voiceDictationWindow.setBounds({
    x: bounds.x,
    y: Math.min(bounds.y, maxY),
    width: WINDOW_WIDTH,
    height: nextHeight,
  })
}

export function hideVoiceDictationWindow(): void {
  const shouldRestoreExternalFocus = voiceDictationTargetCaptured && !voiceDictationTargetIsProma
  suppressPromaActivationBriefly()
  if (voiceDictationWindow && !voiceDictationWindow.isDestroyed() && voiceDictationWindow.isVisible()) {
    voiceDictationWindow.hide()
  }
  if (process.platform === 'darwin' && shouldRestoreExternalFocus) {
    app.hide()
  }
  voiceDictationTargetCaptured = false
  voiceDictationTargetIsProma = false
}

function suppressPromaActivationBriefly(): void {
  if (process.platform !== 'darwin') return
  suppressMainWindowActivateUntil = Date.now() + ACTIVATE_SUPPRESSION_MS
}

export function shouldSuppressVoiceDictationActivate(): boolean {
  if (process.platform !== 'darwin') return false

  const isVoiceWindowVisible =
    !!voiceDictationWindow &&
    !voiceDictationWindow.isDestroyed() &&
    voiceDictationWindow.isVisible()

  if (isVoiceWindowVisible) return true

  if (Date.now() <= suppressMainWindowActivateUntil) {
    return true
  }

  suppressMainWindowActivateUntil = 0
  return false
}

export function getVoiceDictationWindow(): BrowserWindow | null {
  return voiceDictationWindow
}

export function destroyVoiceDictationWindow(): void {
  if (voiceDictationWindow && !voiceDictationWindow.isDestroyed()) {
    voiceDictationWindow.destroy()
    voiceDictationWindow = null
  }
}
