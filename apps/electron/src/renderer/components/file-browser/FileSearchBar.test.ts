import { describe, expect, test } from 'bun:test'
import type { FileIndexEntry } from '@proma/shared'
import { hasMixedFileSources } from './file-search-sources'

function result(source: FileIndexEntry['source']): FileIndexEntry {
  return { name: 'report.md', path: 'report.md', type: 'file', source }
}

describe('文件搜索来源 badge', () => {
  test('会话与项目结果同时存在时显示来源区分', () => {
    expect(hasMixedFileSources([result('session'), result('workspace')])).toBe(true)
  })

  test('结果只有单一来源时不显示冗余 badge', () => {
    expect(hasMixedFileSources([result('session'), result('session')])).toBe(false)
    expect(hasMixedFileSources([result('workspace')])).toBe(false)
    expect(hasMixedFileSources([])).toBe(false)
  })
})
