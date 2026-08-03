import { describe, expect, test } from 'bun:test'
import { redactProxyUrl } from './proxy-settings-service'

describe('proxy settings logging', () => {
  test('Given an authenticated proxy URL When formatting it for logs Then redacts both username and password', () => {
    const value = redactProxyUrl('http://alice:secret@127.0.0.1:7890')

    expect(value).not.toContain('alice')
    expect(value).not.toContain('secret')
    expect(value).toContain('127.0.0.1:7890')
  })

  test('Given a malformed proxy URL When formatting it for logs Then never returns the original value', () => {
    expect(redactProxyUrl('alice:secret@not a url')).toBe('[invalid proxy URL]')
  })
})
