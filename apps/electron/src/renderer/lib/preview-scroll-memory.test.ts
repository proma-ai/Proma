import { describe, expect, test } from 'bun:test'
import {
  clearPreviewScrollPositionsForSession,
  getPreviewScrollPosition,
  savePreviewScrollPosition,
} from './preview-scroll-memory'

describe('preview scroll memory', () => {
  test('given saved position when reading same session and file then returns that position', () => {
    clearPreviewScrollPositionsForSession('session-a')

    savePreviewScrollPosition('session-a', '/tmp/demo.md', { top: 320, left: 12 })

    expect(getPreviewScrollPosition('session-a', '/tmp/demo.md')).toEqual({ top: 320, left: 12 })
  })

  test('given same file keeps being updated when saving new positions then latest position wins', () => {
    clearPreviewScrollPositionsForSession('session-b')

    savePreviewScrollPosition('session-b', '/tmp/demo.md', { top: 480, left: 0 })
    savePreviewScrollPosition('session-b', '/tmp/demo.md', { top: 512, left: 8 })

    expect(getPreviewScrollPosition('session-b', '/tmp/demo.md')).toEqual({ top: 512, left: 8 })
  })

  test('given multiple files in one session when clearing that session then other sessions stay intact', () => {
    clearPreviewScrollPositionsForSession('session-c')
    clearPreviewScrollPositionsForSession('session-d')

    savePreviewScrollPosition('session-c', '/tmp/a.md', { top: 10, left: 0 })
    savePreviewScrollPosition('session-c', '/tmp/b.md', { top: 20, left: 1 })
    savePreviewScrollPosition('session-d', '/tmp/a.md', { top: 30, left: 2 })

    clearPreviewScrollPositionsForSession('session-c')

    expect(getPreviewScrollPosition('session-c', '/tmp/a.md')).toBeUndefined()
    expect(getPreviewScrollPosition('session-c', '/tmp/b.md')).toBeUndefined()
    expect(getPreviewScrollPosition('session-d', '/tmp/a.md')).toEqual({ top: 30, left: 2 })
  })
})
