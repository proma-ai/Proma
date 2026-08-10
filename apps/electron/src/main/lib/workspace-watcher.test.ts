import { describe, expect, it } from 'bun:test'
import { shouldNotifyForWatchFilename } from './workspace-watcher-utils'

describe('shouldNotifyForWatchFilename', () => {
  it('refreshes only Git metadata that changes diff state', () => {
    expect(shouldNotifyForWatchFilename('.git/FETCH_HEAD')).toBe(false)
    expect(shouldNotifyForWatchFilename('.git/objects/pack/pack-a.idx')).toBe(false)
    expect(shouldNotifyForWatchFilename('.git/index')).toBe(true)
    expect(shouldNotifyForWatchFilename('.git/HEAD')).toBe(true)
    expect(shouldNotifyForWatchFilename('node_modules/.cache/index')).toBe(false)
    expect(shouldNotifyForWatchFilename('src\\components\\Button.tsx')).toBe(true)
  })

  it('normalizes Buffer filenames before filtering', () => {
    expect(shouldNotifyForWatchFilename(Buffer.from('.git/index'))).toBe(true)
    expect(shouldNotifyForWatchFilename(Buffer.from('src/file.ts'))).toBe(true)
  })

  it('ignores events without a filename instead of bypassing the noise filter', () => {
    expect(shouldNotifyForWatchFilename(null)).toBe(false)
  })
})
