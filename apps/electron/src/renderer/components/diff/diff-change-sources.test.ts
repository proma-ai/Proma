import { describe, expect, test } from 'bun:test'
import { collectDiffChangeSources, DIFF_CHANGE_SOURCE_CONFIG } from './diff-change-sources'

describe('改动文件来源', () => {
  test('given 同一 Git 仓库含不同来源与未追踪文件 when 聚合来源 then 保留原有 badge 并按稳定顺序展示', () => {
    const sources = collectDiffChangeSources([
      { source: 'workspace' },
      {},
      { source: 'session' },
      { source: 'both' },
      { source: 'session' },
      { source: 'none' },
    ])

    expect(sources).toEqual(['session', 'workspace', 'both', 'none'])
    expect(sources.map((source) => DIFF_CHANGE_SOURCE_CONFIG[source].label)).toEqual([
      '会话文件',
      '项目文件',
      '会话+项目文件',
      '附加目录文件',
    ])
  })

  test('given 仅有未追踪文件 when 聚合来源 then 不展示虚构的来源 badge', () => {
    expect(collectDiffChangeSources([{}, {}])).toEqual([])
  })
})
