import { release } from 'node:os'

// Apple maps macOS 26 to Darwin 25. Future macOS releases use larger Darwin majors.
const MACOS_26_DARWIN_MAJOR = 25

export function isMacOS26OrLater(darwinRelease = release()): boolean {
  const darwinMajor = Number.parseInt(darwinRelease.split('.')[0] ?? '', 10)
  return Number.isFinite(darwinMajor) && darwinMajor >= MACOS_26_DARWIN_MAJOR
}
