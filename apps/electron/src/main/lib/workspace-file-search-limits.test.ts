import { expect, test } from 'bun:test'
import {
  WORKSPACE_FILE_SEARCH_INDEX_ENTRY_CAP_PER_GROUP,
  shouldStopWorkspaceFileSearchScan,
} from './workspace-file-search-limits'

test('允许在 15,000 条上限前继续收集文件搜索索引', () => {
  expect(WORKSPACE_FILE_SEARCH_INDEX_ENTRY_CAP_PER_GROUP).toBe(15_000)
  expect(shouldStopWorkspaceFileSearchScan(10, 14_999)).toBe(false)
})

test('在达到条目上限或超过既有深度限制时停止收集文件搜索索引', () => {
  expect(shouldStopWorkspaceFileSearchScan(10, 15_000)).toBe(true)
  expect(shouldStopWorkspaceFileSearchScan(11, 0)).toBe(true)
})
