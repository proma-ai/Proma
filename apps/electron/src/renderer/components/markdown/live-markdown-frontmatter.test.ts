import { describe, expect, test } from 'bun:test'
import { getLeadingFrontmatter, parseLeadingFrontmatter, serializeFlatLeadingFrontmatter } from './live-markdown-frontmatter'

describe('live markdown frontmatter', () => {
  test('recognizes a leading flat YAML mapping and preserves its field order', () => {
    const lines = [
      '---',
      'type: governance',
      'target: 全局',
      'created: 2026-08-16',
      '---',
      '# 研究动作线业务基线',
    ]

    expect(parseLeadingFrontmatter(lines)).toEqual([
      { key: 'type', value: 'governance' },
      { key: 'target', value: '全局' },
      { key: 'created', value: '2026-08-16' },
    ])
    expect(getLeadingFrontmatter(lines)).toEqual({
      endLine: 5,
      entries: [
        { key: 'type', value: 'governance' },
        { key: 'target', value: '全局' },
        { key: 'created', value: '2026-08-16' },
      ],
    })
  })

  test('accepts a UTF-8 BOM before the opening delimiter', () => {
    expect(getLeadingFrontmatter(['\uFEFF---', 'status: final', '---'])).toEqual({
      endLine: 3,
      entries: [{ key: 'status', value: 'final' }],
    })
  })

  test('keeps malformed, nested, comment-bearing, and non-flat YAML in source mode', () => {
    expect(parseLeadingFrontmatter(['---', 'parent:', '  child: value', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', '# authored by user', 'status: final', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'title: incomplete'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', '"quoted key": value', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'a:b: value', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'title: final # user comment', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', "author: Andreas's note", '---'])).toEqual([{ key: 'author', value: "Andreas's note" }])
    expect(parseLeadingFrontmatter(['---', 'tags: [x, y]', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'meta: {}', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'summary: |', '  multi-line', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'summary: >', '  folded', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'url: https://example.com:8443/path', '---'])).toBeNull()
    expect(parseLeadingFrontmatter(['---', 'reference: &keep value', '---'])).toBeNull()
  })

  test('serializes a property edit from the latest document without losing a prior body edit', () => {
    const latestDocument = [
      '\uFEFF---',
      'status: draft',
      '---',
      'Body changed after the editor mounted.',
    ].join('\r\n')

    expect(serializeFlatLeadingFrontmatter(latestDocument, [{ key: 'status', value: 'final' }])).toBe([
      '\uFEFF---',
      'status: final',
      '---',
      'Body changed after the editor mounted.',
    ].join('\r\n'))
  })
})
