import { describe, expect, test } from 'bun:test'
import { splitMarkdownIntoBlocks } from './markdown-blocks'

describe('splitMarkdownIntoBlocks', () => {
  test('空字符串返回空数组', () => {
    expect(splitMarkdownIntoBlocks('')).toEqual([])
  })

  test('单个段落返回单 block', () => {
    expect(splitMarkdownIntoBlocks('hello world')).toEqual(['hello world'])
  })

  test('空行分隔的段落切分为独立 block', () => {
    const markdown = '第一段\n\n第二段\n\n第三段'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['第一段', '第二段', '第三段'])
  })

  test('连续多个空行只产生一次边界', () => {
    const markdown = '第一段\n\n\n\n第二段'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['第一段', '第二段'])
  })

  test('标题与正文分块', () => {
    const markdown = '# 标题\n\n正文内容'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['# 标题', '正文内容'])
  })

  test('围栏代码块内的空行不切分', () => {
    const markdown = '前文\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n后文'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual([
      '前文',
      '```ts\nconst a = 1\n\nconst b = 2\n```',
      '后文',
    ])
  })

  test('未闭合的围栏代码块（流式中）保持为尾部单 block', () => {
    const markdown = '说明\n\n```python\nprint("a")\n\nprint("b")'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual([
      '说明',
      '```python\nprint("a")\n\nprint("b")',
    ])
  })

  test('波浪线围栏同样不切分', () => {
    const markdown = '~~~\ncode\n\nmore\n~~~\n\n段落'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['~~~\ncode\n\nmore\n~~~', '段落'])
  })

  test('围栏内的短围栏标记不会提前闭合', () => {
    const markdown = '````md\n```\ninner\n```\n````\n\n后文'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual([
      '````md\n```\ninner\n```\n````',
      '后文',
    ])
  })

  test('紧凑列表保持单 block', () => {
    const markdown = '- a\n- b\n- c'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['- a\n- b\n- c'])
  })

  test('loose list（列表项间空行）合并为单 block', () => {
    const markdown = '- 第一项\n\n- 第二项\n\n- 第三项'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['- 第一项\n\n- 第二项\n\n- 第三项'])
  })

  test('有序 loose list 合并为单 block', () => {
    const markdown = '1. one\n\n2. two'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['1. one\n\n2. two'])
  })

  test('列表项的缩进续段合并回列表 block', () => {
    const markdown = '1. 第一项\n\n   续段内容\n\n2. 第二项'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual([
      '1. 第一项\n\n   续段内容\n\n2. 第二项',
    ])
  })

  test('4 空格缩进的列表内嵌内容不会被拆成缩进代码块', () => {
    const markdown = '- item\n\n    nested content'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['- item\n\n    nested content'])
  })

  test('普通段落后的列表不合并（渲染等价）', () => {
    const markdown = '介绍：\n\n- a\n- b'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual(['介绍：', '- a\n- b'])
  })

  test('表格保持单 block', () => {
    const markdown = '| a | b |\n|---|---|\n| 1 | 2 |\n\n后文'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual([
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '后文',
    ])
  })

  test('存在链接引用定义时整体退回单 block', () => {
    const markdown = '看[这里][ref]\n\n[ref]: https://example.com'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual([markdown])
  })

  test('存在脚注定义时整体退回单 block', () => {
    const markdown = '正文[^1]\n\n[^1]: 脚注内容'
    expect(splitMarkdownIntoBlocks(markdown)).toEqual([markdown])
  })

  test('块之间等价重组：join 后与原文语义边界一致', () => {
    const markdown = '# 标题\n\n段落一\n\n```js\ncode()\n```\n\n- l1\n- l2\n\n结尾'
    const blocks = splitMarkdownIntoBlocks(markdown)
    expect(blocks.join('\n\n')).toBe(markdown)
  })

  test('流式前缀稳定性：文本追加不改变已完成 block', () => {
    const early = '第一段\n\n第二段落开始'
    const later = '第一段\n\n第二段落开始继续增长\n\n第三段'
    const earlyBlocks = splitMarkdownIntoBlocks(early)
    const laterBlocks = splitMarkdownIntoBlocks(later)
    expect(laterBlocks[0]).toBe(earlyBlocks[0]!)
  })
})
