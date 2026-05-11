/**
 * 语音输入浮窗管理
 *
 * 独立于快速任务窗口，专注系统级语音听写。
 */

import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import { getSettings, updateSettings } from './settings-service'
import { captureVoiceDictationTarget } from './text-output-service'

let voiceDictationWindow: BrowserWindow | null = null
let voiceDictationTargetIsProma = false
let voiceDictationTargetCaptured = false
let suppressMainWindowActivateUntil = 0
let voiceDictationWindowReady = false
let voiceDictationShowPending = false
let suppressPositionPersistence = false
let suppressPositionPersistenceTimer: ReturnType<typeof setTimeout> | null = null
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null

const WINDOW_WIDTH = 480
const WINDOW_HEIGHT = 160
const MIN_WINDOW_HEIGHT = 148
const WINDOW_MARGIN = 12
const ACTIVATE_SUPPRESSION_MS = 1800
const POSITION_SAVE_DEBOUNCE_MS = 240
const VOICE_DICTATION_PARTITION = 'voice-dictation'

interface VoiceDictationToggleOptions {
  targetIsProma?: boolean
}

export function createVoiceDictationWindow(): void {
  if (voiceDictationWindow && !voiceDictationWindow.isDestroyed()) return

  voiceDictationWindowReady = false
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
    movable: true,
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
      partition: VOICE_DICTATION_PARTITION,
    },
  })
  installVoiceDictationMediaPermissions(voiceDictationWindow)
  installVoiceDictationPositionPersistence(voiceDictationWindow)

  const isDev = !app.isPackaged
  if (isDev) {
    voiceDictationWindow.loadURL('http://localhost:5173?window=voice-dictation')
  } else {
    voiceDictationWindow.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'voice-dictation' },
    })
  }

  voiceDictationWindow.on('close', () => {
    flushPendingVoiceDictationPositionSave()
  })

  voiceDictationWindow.on('closed', () => {
    clearPositionPersistenceTimers()
    voiceDictationWindow = null
    voiceDictationWindowReady = false
    voiceDictationShowPending = false
  })

  voiceDictationWindow.once('ready-to-show', () => {
    voiceDictationWindowReady = true
    flushPendingShowIfReady()
  })

  voiceDictationWindow.webContents.on('did-finish-load', () => {
    flushPendingShowIfReady()
  })

  console.log('[语音输入] 浮窗预创建完成')
}

export function toggleVoiceDictationWindow(options: VoiceDictationToggleOptions = {}): void {
  const win = voiceDictationWindow && !voiceDictationWindow.isDestroyed() ? voiceDictationWindow : null

  if (win?.isVisible()) {
    win.webContents.send(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP)
    return
  }

  if (!isVoiceDictationEnabled()) {
    console.log('[语音输入] 功能未启用，忽略唤起请求')
    return
  }

  if (!win) {
    captureTargetForNextSession(options.targetIsProma)
    createVoiceDictationWindow()
    requestPositionAndShow()
    return
  }

  captureTargetForNextSession(options.targetIsProma)
  requestPositionAndShow()
}

function isVoiceDictationEnabled(): boolean {
  return getSettings().voiceDictation?.enabled === true
}

function installVoiceDictationMediaPermissions(win: BrowserWindow): void {
  const voiceSession = win.webContents.session

  voiceSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== 'media') return false
    if (details.mediaType === 'video') return false

    return isTrustedVoiceDictationUrl(
      details.requestingUrl ??
      details.securityOrigin ??
      webContents?.getURL() ??
      requestingOrigin,
    )
  })

  voiceSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== 'media') {
      callback(false)
      return
    }

    const mediaDetails = details as Electron.MediaAccessPermissionRequest
    const requestsVideo = mediaDetails.mediaTypes?.includes('video') ?? false
    const isTrustedRequest = isTrustedVoiceDictationUrl(
      mediaDetails.requestingUrl ??
      mediaDetails.securityOrigin ??
      webContents.getURL(),
    )

    callback(isTrustedRequest && !requestsVideo)
  })
}

function isTrustedVoiceDictationUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false

  try {
    const parsed = new URL(rawUrl)
    if (!app.isPackaged && parsed.origin === 'http://localhost:5173') {
      return true
    }
    return parsed.protocol === 'file:'
  } catch {
    return false
  }
}

function requestPositionAndShow(): void {
  if (!voiceDictationWindow || voiceDictationWindow.isDestroyed()) return

  if (!voiceDictationWindowReady || voiceDictationWindow.webContents.isLoading()) {
    voiceDictationShowPending = true
    return
  }

  positionAndShow()
}

function flushPendingShowIfReady(): void {
  if (
    !voiceDictationWindow ||
    voiceDictationWindow.isDestroyed() ||
    !voiceDictationShowPending ||
    !voiceDictationWindowReady ||
    voiceDictationWindow.webContents.isLoading()
  ) {
    return
  }

  voiceDictationShowPending = false
  positionAndShow()
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

  setVoiceDictationBoundsWithoutSaving(getInitialVoiceDictationBounds())

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
  setVoiceDictationBoundsWithoutSaving(clampBoundsToVisibleWorkArea({
    x: bounds.x,
    y: bounds.y,
    width: WINDOW_WIDTH,
    height: nextHeight,
  }))
}

export function hideVoiceDictationWindow(): void {
  const shouldRestoreExternalFocus = voiceDictationTargetCaptured && !voiceDictationTargetIsProma
  flushPendingVoiceDictationPositionSave()
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

function getInitialVoiceDictationBounds(): Electron.Rectangle {
  const savedPosition = getSavedVoiceDictationPosition()
  if (savedPosition) {
    return clampBoundsToVisibleWorkArea({
      x: savedPosition.x,
      y: savedPosition.y,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x, y, width, height } = display.workArea

  return clampBoundsToVisibleWorkArea({
    x: Math.round(x + (width - WINDOW_WIDTH) / 2),
    y: Math.round(y + height * 0.28),
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })
}

function getSavedVoiceDictationPosition(): Electron.Point | null {
  const position = getSettings().voiceDictation?.windowPosition
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
  }
}

function clampBoundsToVisibleWorkArea(bounds: Electron.Rectangle): Electron.Rectangle {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + Math.min(bounds.height / 2, 48)),
  })
  const { workArea } = display
  const minX = workArea.x + WINDOW_MARGIN
  const maxX = workArea.x + workArea.width - bounds.width - WINDOW_MARGIN
  const minY = workArea.y + WINDOW_MARGIN
  const maxY = workArea.y + workArea.height - bounds.height - WINDOW_MARGIN

  return {
    ...bounds,
    x: clamp(bounds.x, minX, maxX),
    y: clamp(bounds.y, minY, maxY),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}

function setVoiceDictationBoundsWithoutSaving(bounds: Electron.Rectangle): void {
  if (!voiceDictationWindow || voiceDictationWindow.isDestroyed()) return

  suppressPositionPersistence = true
  voiceDictationWindow.setBounds(bounds)
  if (suppressPositionPersistenceTimer) {
    clearTimeout(suppressPositionPersistenceTimer)
  }
  suppressPositionPersistenceTimer = setTimeout(() => {
    suppressPositionPersistence = false
    suppressPositionPersistenceTimer = null
  }, 120)
}

function installVoiceDictationPositionPersistence(win: BrowserWindow): void {
  const persistPosition = (): void => {
    if (suppressPositionPersistence) return
    scheduleVoiceDictationPositionSave()
  }

  win.on('move', persistPosition)
  win.on('moved', persistPosition)
}

function scheduleVoiceDictationPositionSave(): void {
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null
    saveVoiceDictationPosition()
  }, POSITION_SAVE_DEBOUNCE_MS)
}

function flushPendingVoiceDictationPositionSave(): void {
  if (!positionSaveTimer) return
  clearTimeout(positionSaveTimer)
  positionSaveTimer = null
  saveVoiceDictationPosition()
}

function saveVoiceDictationPosition(): void {
  if (!voiceDictationWindow || voiceDictationWindow.isDestroyed()) return
  const { x, y } = voiceDictationWindow.getBounds()
  const settings = getSettings()
  updateSettings({
    voiceDictation: {
      ...(settings.voiceDictation ?? {}),
      windowPosition: {
        x,
        y,
      },
    },
  })
}

function clearPositionPersistenceTimers(): void {
  if (positionSaveTimer) {
    clearTimeout(positionSaveTimer)
    positionSaveTimer = null
  }
  if (suppressPositionPersistenceTimer) {
    clearTimeout(suppressPositionPersistenceTimer)
    suppressPositionPersistenceTimer = null
  }
  suppressPositionPersistence = false
}

export function destroyVoiceDictationWindow(): void {
  if (voiceDictationWindow && !voiceDictationWindow.isDestroyed()) {
    flushPendingVoiceDictationPositionSave()
    voiceDictationWindow.destroy()
    voiceDictationWindow = null
  }
}
