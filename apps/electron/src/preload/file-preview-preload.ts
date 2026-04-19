/**
 * 文件预览窗口专用 preload
 *
 * 通过 contextBridge 暴露轻量编辑 API 给预览窗口的 HTML 模板。
 * 主窗口的 preload 不复用，避免预览窗口拿到无关的全部 API。
 */

import { contextBridge, ipcRenderer } from 'electron'

const PREVIEW_IPC = {
  GET_INITIAL: 'preview:get-initial',
  SAVE: 'preview:save',
  SET_DIRTY: 'preview:set-dirty',
  OPEN_EXTERNAL: 'preview:open-external',
  SHOW_IN_FOLDER: 'preview:show-in-folder',
  CLOSE: 'preview:close',
  ON_RELOAD: 'preview:on-reload',
  ON_EXTERNAL_CHANGED: 'preview:on-external-changed',
} as const

export interface PreviewInitialPayload {
  filePath: string
  filename: string
  content: string
  language: string
  isDark: boolean
  type: 'markdown' | 'code'
}

export interface PreviewSaveResult {
  success: boolean
  error?: string
}

export interface PreviewAPI {
  getInitial: () => Promise<PreviewInitialPayload>
  save: (content: string) => Promise<PreviewSaveResult>
  setDirty: (dirty: boolean) => void
  openExternal: () => void
  showInFolder: () => void
  close: () => void
  onReload: (callback: (content: string) => void) => () => void
  onExternalChanged: (callback: (content: string) => void) => () => void
}

const previewAPI: PreviewAPI = {
  getInitial: () => ipcRenderer.invoke(PREVIEW_IPC.GET_INITIAL),
  save: (content: string) => ipcRenderer.invoke(PREVIEW_IPC.SAVE, content),
  setDirty: (dirty: boolean) => { ipcRenderer.send(PREVIEW_IPC.SET_DIRTY, dirty) },
  openExternal: () => { ipcRenderer.send(PREVIEW_IPC.OPEN_EXTERNAL) },
  showInFolder: () => { ipcRenderer.send(PREVIEW_IPC.SHOW_IN_FOLDER) },
  close: () => { ipcRenderer.send(PREVIEW_IPC.CLOSE) },
  onReload: (callback) => {
    const listener = (_: unknown, content: string): void => callback(content)
    ipcRenderer.on(PREVIEW_IPC.ON_RELOAD, listener)
    return () => { ipcRenderer.removeListener(PREVIEW_IPC.ON_RELOAD, listener) }
  },
  onExternalChanged: (callback) => {
    const listener = (_: unknown, content: string): void => callback(content)
    ipcRenderer.on(PREVIEW_IPC.ON_EXTERNAL_CHANGED, listener)
    return () => { ipcRenderer.removeListener(PREVIEW_IPC.ON_EXTERNAL_CHANGED, listener) }
  },
}

contextBridge.exposeInMainWorld('previewAPI', previewAPI)

declare global {
  interface Window {
    previewAPI: PreviewAPI
  }
}
