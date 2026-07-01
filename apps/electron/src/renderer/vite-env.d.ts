/// <reference types="vite/client" />

// Vite define 注入的全局常量
/** 应用版本号 */
declare const __APP_VERSION__: string
/** 应用运行模式: 'local' | 'cloud' */
declare const __PROMA_MODE__: 'local' | 'cloud'

// CSS 模块类型声明
declare module '*.css' {
  const content: Record<string, string>
  export default content
}

// 音频资源类型声明
declare module '*.wav' {
  const src: string
  export default src
}

declare module '*.mp3' {
  const src: string
  export default src
}

/** 更新状态（与 updater-types.ts 保持一致） */
interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
  version?: string
  releaseNotes?: string
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number }
  error?: string
}

/** 更新 API */
interface UpdaterAPI {
  checkForUpdates: () => Promise<void>
  getStatus: () => Promise<UpdateStatus>
  onStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
  quitAndInstall: () => Promise<void>
}

// 附件临时 base64 缓存（用于发送前暂存数据）
interface Window {
  __pendingAttachmentData?: Map<string, string>
  __pendingAgentFileData?: Map<string, string>
}
