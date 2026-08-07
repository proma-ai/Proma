import { release } from 'node:os'

// Apple maps macOS 26 to Darwin 25. Future macOS releases use larger Darwin majors.
const MACOS_26_DARWIN_MAJOR = 25

export function isMacOS26OrLater(darwinRelease = release()): boolean {
  const darwinMajor = Number.parseInt(darwinRelease.split('.')[0] ?? '', 10)
  return Number.isFinite(darwinMajor) && darwinMajor >= MACOS_26_DARWIN_MAJOR
}

/** Agent Island 仅在 macOS 26+ 使用原生 Swift/AppKit surface。 */
export function isAgentIslandSupported(platform = process.platform, darwinRelease = release()): boolean {
  return platform === 'darwin' && isMacOS26OrLater(darwinRelease)
}
