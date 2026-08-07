import { describe, expect, it } from 'bun:test'
import { isAgentIslandSupported } from './macos-version'

describe('isAgentIslandSupported', () => {
  it('only enables the native surface on macOS 26 and later', () => {
    expect(isAgentIslandSupported('win32', '10.0.26100')).toBe(false)
    expect(isAgentIslandSupported('linux', '6.0.0')).toBe(false)
    expect(isAgentIslandSupported('darwin', '24.6.0')).toBe(false)
    expect(isAgentIslandSupported('darwin', '25.0.0')).toBe(true)
  })
})
