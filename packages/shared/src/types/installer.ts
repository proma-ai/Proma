/**
 * 第三方安装包（Git、Node.js 等）相关类型
 *
 * Proma 通过 proma-api 的 /installers/manifest 接口拿到可安装的第三方工具清单，
 * 让 Windows 用户一键下载并自动拉起官方安装程序。
 */

/**
 * 单个安装包源
 *
 * 一个工具在某一 (platform, arch) 下的一份下载元数据。
 */
export interface InstallerSource {
  /** 工具 ID，如 'git-for-windows' / 'nodejs' */
  id: string
  /** 平台：目前只支持 'win32' */
  platform: 'win32'
  /** CPU 架构 */
  arch: 'x64' | 'arm64'
  /** 版本号，如 '2.47.1' */
  version: string
  /** 自建 OSS 的签名下载 URL（短期有效） */
  downloadUrl: string
  /** 官方上游 URL，OSS 不可达时降级 */
  fallbackUrl: string
  /** 文件 sha256，用于下载后校验 */
  sha256: string
  /** 预期文件大小（字节），用于进度展示 */
  sizeBytes: number
  /** 下载到本地的文件名 */
  filename: string
}

/**
 * 安装包清单（API 响应）
 */
export interface InstallerManifest {
  installers: InstallerSource[]
}

/**
 * 下载进度事件载荷
 */
export interface InstallerProgressPayload {
  /** 对应的 installer id + arch，用于区分多个并发下载 */
  key: string
  /** 已下载字节数 */
  downloaded: number
  /** 总字节数（来自 manifest） */
  total: number
  /** 瞬时速度（字节/秒） */
  speed: number
}

/**
 * 下载结果
 */
export interface InstallerDownloadResult {
  /** 本地文件绝对路径 */
  filePath: string
  /** 校验通过的 sha256 */
  sha256: string
}

/**
 * 一键下载时前端传入的请求参数
 */
export interface InstallerDownloadRequest {
  /** 工具 id，如 'git-for-windows' */
  id: string
  /** CPU 架构 */
  arch: 'x64' | 'arm64'
}

/**
 * Installer IPC 通道
 */
export const INSTALLER_IPC_CHANNELS = {
  /** 获取安装包清单（优先远程，失败回退内置） */
  MANIFEST: 'installer:manifest',
  /** 开始下载（参数：InstallerDownloadRequest） */
  DOWNLOAD: 'installer:download',
  /** 取消下载（参数：key） */
  CANCEL: 'installer:cancel',
  /** 拉起已下载的安装程序（参数：filePath） */
  LAUNCH: 'installer:launch',
  /** 下载进度事件（main → renderer） */
  PROGRESS: 'installer:progress',
} as const
