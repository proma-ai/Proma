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

  it('ignores Python, test and build cache directories', () => {
    const noisyPaths = [
      '.venv/lib/python3.12/site-packages/pkg.py',
      'venv/Lib/site-packages/pkg.py',
      '.tox/py312/lib/pkg.py',
      '.nox/tests/lib/pkg.py',
      '__pypackages__/3.12/lib/pkg.py',
      '.pytest_cache/v/cache/lastfailed',
      '.mypy_cache/3.12/pkg.meta.json',
      '.ruff_cache/0.8.0/cache',
      '.hypothesis/examples/example.db',
      '.gradle/caches/modules-2/metadata.bin',
    ]

    for (const path of noisyPaths) {
      expect(shouldNotifyForWatchFilename(path)).toBe(false)
    }
  })

  it('keeps generic coverage and target directories observable', () => {
    expect(shouldNotifyForWatchFilename('coverage/lcov.info')).toBe(true)
    expect(shouldNotifyForWatchFilename('target/debug/generated.rs')).toBe(true)
  })

  it('normalizes Buffer filenames before filtering', () => {
    expect(shouldNotifyForWatchFilename(Buffer.from('.git/index'))).toBe(true)
    expect(shouldNotifyForWatchFilename(Buffer.from('src/file.ts'))).toBe(true)
  })

  it('ignores events without a filename instead of bypassing the noise filter', () => {
    expect(shouldNotifyForWatchFilename(null)).toBe(false)
  })
})
