import { describe, expect, it } from 'bun:test'
import { shouldNotifyForWatchFilename } from './workspace-watcher-utils'

describe('shouldNotifyForWatchFilename', () => {
  it('ignores Git metadata and other high-noise paths', () => {
    expect(shouldNotifyForWatchFilename('.git/FETCH_HEAD')).toBe(false)
    expect(shouldNotifyForWatchFilename('node_modules/.cache/index')).toBe(false)
    expect(shouldNotifyForWatchFilename('src\\components\\Button.tsx')).toBe(true)
  })

  it('normalizes Buffer filenames before filtering', () => {
    expect(shouldNotifyForWatchFilename(Buffer.from('.git/index'))).toBe(false)
    expect(shouldNotifyForWatchFilename(Buffer.from('src/file.ts'))).toBe(true)
  })

  it('ignores events without a filename instead of bypassing the noise filter', () => {
    expect(shouldNotifyForWatchFilename(null)).toBe(false)
  })
})
