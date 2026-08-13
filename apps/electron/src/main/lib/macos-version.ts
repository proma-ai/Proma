import { release } from 'node:os'

// Apple maps macOS 26 to Darwin 25. Future macOS releases use larger Darwin majors.
const MACOS_26_DARWIN_MAJOR = 25

export function isMacOS26OrLater(darwinRelease = release()): boolean {
  const darwinMajor = Number.parseInt(darwinRelease.split('.')[0] ?? '', 10)
  return Number.isFinite(darwinMajor) && darwinMajor >= MACOS_26_DARWIN_MAJOR
}

/** 状态机支持的平台：macOS 和 Windows 都初始化 AgentIslandService。Linux 暂不支持。 */
export function isAgentIslandServiceSupported(platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/** macOS Swift/AppKit surface 仅在 macOS 26+ 启动。 */
export function isMacAgentIslandSurfaceSupported(platform = process.platform, darwinRelease = release()): boolean {
  return platform === 'darwin' && isMacOS26OrLater(darwinRelease)
}

/** @deprecated 改用 isMacAgentIslandSurfaceSupported() */
export function isAgentIslandSupported(platform = process.platform, darwinRelease = release()): boolean {
  return isMacAgentIslandSurfaceSupported(platform, darwinRelease)
}
