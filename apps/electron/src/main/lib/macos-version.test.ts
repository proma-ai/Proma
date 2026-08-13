import { describe, expect, test } from 'bun:test'
import {
  isAgentIslandServiceSupported,
  isMacAgentIslandSurfaceSupported,
  isAgentIslandSupported,
} from './macos-version'

const DARWIN_25 = '25.0.0'
const DARWIN_24 = '24.0.0'

describe('isAgentIslandServiceSupported', () => {
  test('Given macOS When checking Then returns true regardless of version', () => {
    expect(isAgentIslandServiceSupported('darwin')).toBe(true)
    expect(isAgentIslandServiceSupported('darwin')).toBe(true)
  })

  test('Given Windows When checking Then returns true', () => {
    expect(isAgentIslandServiceSupported('win32')).toBe(true)
  })

  test('Given Linux When checking Then returns false', () => {
    expect(isAgentIslandServiceSupported('linux')).toBe(false)
  })
})

describe('isMacAgentIslandSurfaceSupported', () => {
  test('Given macOS Darwin 25 (macOS 26) When checking Then returns true', () => {
    expect(isMacAgentIslandSurfaceSupported('darwin', DARWIN_25)).toBe(true)
  })

  test('Given macOS Darwin 24 (macOS 15) When checking Then returns false', () => {
    expect(isMacAgentIslandSurfaceSupported('darwin', DARWIN_24)).toBe(false)
  })

  test('Given Windows When checking Then returns false', () => {
    expect(isMacAgentIslandSurfaceSupported('win32', DARWIN_25)).toBe(false)
  })

  test('Given Linux When checking Then returns false', () => {
    expect(isMacAgentIslandSurfaceSupported('linux', DARWIN_25)).toBe(false)
  })
})

describe('isAgentIslandSupported (deprecated alias)', () => {
  test('Given macOS Darwin 25 When checking Then delegates to surface supported', () => {
    expect(isAgentIslandSupported('darwin', DARWIN_25)).toBe(true)
  })

  test('Given Windows When checking Then returns false (surface is Mac-only)', () => {
    expect(isAgentIslandSupported('win32', DARWIN_25)).toBe(false)
  })
})
