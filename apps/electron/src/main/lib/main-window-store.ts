import type { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null

/** 由应用入口维护、供底层服务安全读取的主窗口引用。 */
export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}
