/// <reference types="vite/client" />

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
  /** 在所有运行中的 Agent 结束后重启并安装更新 */
  installWhenIdle: () => Promise<boolean>
  /** 取消尚未执行的空闲安装请求 */
  cancelIdleInstall: () => Promise<void>
}

interface PromaPerformanceDiagnostics {
  snapshot: () => import('./lib/performance-monitor').PerformanceSnapshot
  clear: () => void
}

// 附件临时 base64 缓存（用于发送前暂存数据）
interface Window {
  __pendingAttachmentData?: Map<string, string>
  __pendingAgentFileData?: Map<string, string>
  /** 仅在 ?perf=1 或 proma-performance-debug=1 时安装的性能诊断接口。 */
  __promaPerformance?: PromaPerformanceDiagnostics
}
