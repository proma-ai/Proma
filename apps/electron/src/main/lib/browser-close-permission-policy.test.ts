import { describe, expect, test } from 'bun:test'
import { resolveBrowserClosePermission } from './browser-close-permission-policy'

describe('BrowserClose permission policy', () => {
  test('requires a single approval for a user session', () => {
    expect(resolveBrowserClosePermission('BrowserClose', 'user')).toBe('require-single-approval')
  })

  test('rejects unattended automation and delegation runs', () => {
    expect(resolveBrowserClosePermission('BrowserClose', 'automation')).toBe('deny-unattended')
    expect(resolveBrowserClosePermission('BrowserClose', 'delegation')).toBe('deny-unattended')
  })

  test('allows other browser tools to follow their existing policy', () => {
    expect(resolveBrowserClosePermission('BrowserCloseTab', 'user')).toBe('allow')
  })
})
