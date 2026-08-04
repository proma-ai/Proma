import { release } from 'node:os'

// Apple maps macOS 26 to Darwin 25. Future macOS releases use larger Darwin majors.
const MACOS_26_DARWIN_MAJOR = 25

export function isMacOS26OrLater(darwinRelease = release()): boolean {
  const darwinMajor = Number.parseInt(darwinRelease.split('.')[0] ?? '', 10)
  return Number.isFinite(darwinMajor) && darwinMajor >= MACOS_26_DARWIN_MAJOR
}

/**
 * Agent Island uses macOS 26's Liquid Glass-era menu-bar treatment. Earlier
 * macOS versions must not create either the native panel or Electron fallback.
 */
export function isAgentIslandSupported(platform = process.platform, darwinRelease = release()): boolean {
  return platform !== 'darwin' || isMacOS26OrLater(darwinRelease)
}
