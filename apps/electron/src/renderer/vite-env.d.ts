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
  installScheduled?: boolean
}

/** 更新 API */
interface UpdaterAPI {
  checkForUpdates: () => Promise<void>
  /** Renderer 网络恢复只上报主进程；不会在 Renderer 内执行更新检查。 */
  notifyOnline: () => void
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
