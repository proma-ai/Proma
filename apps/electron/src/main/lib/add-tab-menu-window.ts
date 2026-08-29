import { app, BrowserWindow, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { BrowserAddTabMenuAction, BrowserAddTabMenuInput } from '@proma/shared'

type PendingAddTabMenu = {
  popup: BrowserWindow
  finish: (action: BrowserAddTabMenuAction | null) => void
}

type AddTabMenuWindowState = {
  popup: BrowserWindow
  ownerWebContentsId: number
  ready: Promise<void>
}

const MENU_WIDTH = 224
const MENU_HEIGHT = 356
const MENU_MARGIN = 8
const VALID_ACTIONS = new Set<BrowserAddTabMenuAction>([
  'browser', 'file', 'terminal', 'todos', 'calendar', 'skills', 'mcp', 'memory', 'automations', 'vault',
])
const pendingMenus = new Map<string, PendingAddTabMenu>()
let menuWindowState: AddTabMenuWindowState | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function resolveMenuBounds(input: BrowserAddTabMenuInput): Electron.Rectangle {
  const display = screen.getDisplayNearestPoint({ x: input.x, y: input.y })
  const { x, y, width, height } = display.workArea
  const right = x + width
  const bottom = y + height
  const popupX = clamp(Math.round(input.x - MENU_WIDTH + 28), x + MENU_MARGIN, right - MENU_WIDTH - MENU_MARGIN)
  const belowY = Math.round(input.y + 8)
  const popupY = belowY + MENU_HEIGHT + MENU_MARGIN <= bottom
    ? belowY
    : Math.round(input.y - MENU_HEIGHT - 8)
  return {
    x: popupX,
    y: clamp(popupY, y + MENU_MARGIN, bottom - MENU_HEIGHT - MENU_MARGIN),
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
  }
}

function createAddTabMenuWindow(mainWindow: BrowserWindow): AddTabMenuWindowState {
  const initialToken = randomUUID()
  let resolveReady: (() => void) | null = null
  let rejectReady: ((error: Error) => void) | null = null
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const popup = new BrowserWindow({
    x: 0,
    y: 0,
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    parent: mainWindow,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const state: AddTabMenuWindowState = { popup, ownerWebContentsId: mainWindow.webContents.id, ready }
  menuWindowState = state

  popup.once('ready-to-show', () => resolveReady?.())
  popup.on('blur', () => {
    for (const pending of pendingMenus.values()) {
      if (pending.popup === popup) pending.finish(null)
    }
  })
  popup.on('closed', () => {
    for (const pending of pendingMenus.values()) {
      if (pending.popup === popup) pending.finish(null)
    }
    if (menuWindowState?.popup === popup) menuWindowState = null
  })
  popup.webContents.once('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    rejectReady?.(new Error(errorDescription))
    if (menuWindowState?.popup === popup) {
      menuWindowState = null
      if (!popup.isDestroyed()) popup.destroy()
    }
  })

  const url = `http://127.0.0.1:5173?window=add-tab-menu&token=${encodeURIComponent(initialToken)}`
  const loadPromise = app.isPackaged
    ? popup.loadFile(join(__dirname, 'renderer', 'index.html'), { query: { window: 'add-tab-menu', token: initialToken } })
    : popup.loadURL(url)
  loadPromise.catch((error) => {
    rejectReady?.(error instanceof Error ? error : new Error(String(error)))
    if (menuWindowState?.popup === popup) {
      menuWindowState = null
      if (!popup.isDestroyed()) popup.destroy()
    }
  })

  return state
}

export function prepareAddTabMenuWindow(mainWindow: BrowserWindow): void {
  if (
    menuWindowState?.popup
    && !menuWindowState.popup.isDestroyed()
    && menuWindowState.ownerWebContentsId === mainWindow.webContents.id
  ) return
  destroyAddTabMenuWindow()
  const state = createAddTabMenuWindow(mainWindow)
  void state.ready.catch((error) => {
    console.error('[右侧工作区] 预热样式菜单失败:', error)
    if (!state.popup.isDestroyed()) state.popup.destroy()
  })
}

export function destroyAddTabMenuWindow(): void {
  const popup = menuWindowState?.popup ?? null
  for (const pending of [...pendingMenus.values()]) {
    if (!popup || pending.popup === popup) pending.finish(null)
  }
  if (popup && !popup.isDestroyed()) popup.destroy()
  menuWindowState = null
}

export function openAddTabMenuWindow(
  mainWindow: BrowserWindow,
  input: BrowserAddTabMenuInput,
): Promise<BrowserAddTabMenuAction | null> {
  if (
    menuWindowState?.popup?.isDestroyed()
    || menuWindowState?.ownerWebContentsId !== mainWindow.webContents.id
  ) {
    destroyAddTabMenuWindow()
  }
  const state = menuWindowState ?? createAddTabMenuWindow(mainWindow)
  const { popup, ready } = state
  const invocationToken = randomUUID()

  return new Promise((resolve) => {
    let settled = false
    const finish = (action: BrowserAddTabMenuAction | null): void => {
      if (settled) return
      settled = true
      pendingMenus.delete(invocationToken)
      if (!popup.isDestroyed()) popup.hide()
      resolve(action)
    }

    for (const pending of [...pendingMenus.values()]) pending.finish(null)
    pendingMenus.set(invocationToken, { popup, finish })

    void ready.then(() => {
      if (settled || popup.isDestroyed() || pendingMenus.get(invocationToken)?.finish !== finish) return
      popup.webContents.send(AGENT_IPC_CHANNELS.SET_ADD_TAB_MENU_TOKEN, invocationToken)
      popup.setBounds(resolveMenuBounds(input))
      popup.show()
      popup.focus()
    }).catch((error) => {
      console.error('[右侧工作区] 打开样式菜单失败:', error)
      finish(null)
    })
  })
}

export function isBrowserAddTabMenuAction(value: unknown): value is BrowserAddTabMenuAction {
  return typeof value === 'string' && VALID_ACTIONS.has(value as BrowserAddTabMenuAction)
}

export function selectAddTabMenuAction(
  token: string,
  action: BrowserAddTabMenuAction,
  senderWebContentsId: number,
): void {
  const pending = pendingMenus.get(token)
  if (!pending || pending.popup.isDestroyed() || pending.popup.webContents.id !== senderWebContentsId) {
    throw new Error('无效的右侧工作区菜单请求。')
  }
  pending.finish(action)
}
