/**
 * 独立预览窗口管理
 *
 * 主窗口将当前预览 payload 交给主进程保存，独立窗口通过 previewId 读取。
 * 避免把长路径和 basePaths 全部塞进 URL。
 */

import { app, BrowserWindow, screen, shell } from 'electron'
import type { Rectangle } from 'electron'
import { basename, join } from 'path'
import type { DetachedPreviewWindowData, DetachedPreviewWindowInput } from '@proma/shared'

const previewDataById = new Map<string, DetachedPreviewWindowData>()
const previewWindowsById = new Map<string, BrowserWindow>()
const previewIdBySignature = new Map<string, string>()

function makePreviewId(): string {
  return `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function makeSignature(input: DetachedPreviewWindowInput): string {
  return JSON.stringify({
    sessionId: input.sessionId,
    filePath: input.filePath,
    dirPath: input.dirPath,
    gitRoot: input.gitRoot,
    previewOnly: input.previewOnly === true,
    readOnly: input.readOnly === true,
    basePaths: input.basePaths ?? [],
  })
}

function getWindowTitle(input: DetachedPreviewWindowInput): string {
  return input.title?.trim() || basename(input.filePath) || '文件预览'
}

function centerBoundsNearSource(sourceWindow?: BrowserWindow | null): Rectangle {
  const display = sourceWindow && !sourceWindow.isDestroyed()
    ? screen.getDisplayMatching(sourceWindow.getBounds())
    : screen.getPrimaryDisplay()
  const { x, y, width: screenWidth, height: screenHeight } = display.workArea
  const width = Math.max(640, Math.min(1100, Math.floor(screenWidth * 0.88)))
  const height = Math.max(480, Math.min(760, Math.floor(screenHeight * 0.86)))

  return {
    x: x + Math.round((screenWidth - width) / 2),
    y: y + Math.round((screenHeight - height) / 2),
    width,
    height,
  }
}

function installDetachedPreviewShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const key = input.key.toLowerCase()
    const closeByEscape = key === 'escape' && !input.meta && !input.control && !input.alt
    const closeByWindowShortcut = key === 'w' && (input.meta || input.control) && !input.alt
    if (!closeByEscape && !closeByWindowShortcut) return

    event.preventDefault()
    if (!win.isDestroyed()) {
      win.close()
    }
  })
}

export function openDetachedPreviewWindow(
  input: DetachedPreviewWindowInput,
  sourceWindow?: BrowserWindow | null,
): string | null {
  if (!input.sessionId || !input.filePath || !input.dirPath) return null

  const signature = makeSignature(input)
  const existingId = previewIdBySignature.get(signature)
  const existingWindow = existingId ? previewWindowsById.get(existingId) : null
  if (existingId && existingWindow && !existingWindow.isDestroyed()) {
    if (existingWindow.isMinimized()) existingWindow.restore()
    existingWindow.show()
    existingWindow.focus()
    return existingId
  }

  const id = makePreviewId()
  const data: DetachedPreviewWindowData = {
    ...input,
    id,
    title: getWindowTitle(input),
  }
  previewDataById.set(id, data)
  previewIdBySignature.set(signature, id)

  const bounds = centerBoundsNearSource(sourceWindow)
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 480,
    title: data.title,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  previewWindowsById.set(id, win)
  installDetachedPreviewShortcuts(win)

  const isDev = !app.isPackaged
  if (isDev) {
    win.loadURL(`http://localhost:5173?window=detached-preview&previewId=${encodeURIComponent(id)}`)
  } else {
    win.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'detached-preview', previewId: id },
    })
  }

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  win.on('closed', () => {
    previewWindowsById.delete(id)
    previewDataById.delete(id)
    if (previewIdBySignature.get(signature) === id) {
      previewIdBySignature.delete(signature)
    }
  })

  return id
}

export function getDetachedPreviewWindowData(id: string): DetachedPreviewWindowData | null {
  return previewDataById.get(id) ?? null
}
