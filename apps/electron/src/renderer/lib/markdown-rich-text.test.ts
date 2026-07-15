import { describe, expect, test } from 'bun:test'
import { markdownToHtml } from './markdown-rich-text'

describe('markdownToHtml rich preview blocks', () => {
  test('renders leading yaml frontmatter as a collapsible metadata block', () => {
    const html = markdownToHtml([
      '---',
      'title: ChatGPT Pro 20x 官方订阅省 30%',
      'type: X Article / 长推 草稿',
      'status: draft v1',
      '---',
      '',
      '# 标题（备选）',
    ].join('\n'))

    expect(html).toContain('前置元数据')
    expect(html).toContain('title: ChatGPT Pro 20x 官方订阅省 30%')
    expect(html).toContain('type: X Article / 长推 草稿')
    expect(html).toContain('<h1>标题（备选）</h1>')
  })

  test('does not treat an opening thematic break as frontmatter without a closing fence', () => {
    const html = markdownToHtml([
      '---',
      '',
      '# 标题（备选）',
    ].join('\n'))

    expect(html).toContain('<hr>')
    expect(html).not.toContain('前置元数据')
    expect(html).toContain('<h1>标题（备选）</h1>')
  })

  test('renders markdown tables as standard HTML tables', () => {
    const html = markdownToHtml([
      '| Header 1 | Header 2 |',
      '| --- | --- |',
      '| Cell 1 | Cell 2 |',
    ].join('\n'))

    expect(html).toContain('<table>')
    expect(html).toContain('<th>Header 1</th>')
    expect(html).toContain('<td>Cell 1</td>')
  })

  test('renders markdown inside details blocks while preserving the source markdown', () => {
    const html = markdownToHtml([
      '<details> <summary>More</summary>',
      'Hidden **text**',
      '- item',
      '</details>',
    ].join('\n'))

    expect(html).toContain('data-type="raw-html-block"')
    expect(html).toContain('data-markdown="&lt;details&gt; &lt;summary&gt;More&lt;/summary&gt;&#10;Hidden **text**&#10;- item&#10;&lt;/details&gt;"')
    expect(html).toContain('&lt;strong&gt;text&lt;/strong&gt;')
    expect(html).toContain('&lt;li&gt;item&lt;/li&gt;')
  })

  test('keeps markdown after standalone html media renderable', () => {
    const html = markdownToHtml([
      '<img src="晨光.jpg">',
      '### Agent 模式',
    ].join('\n'))

    expect(html).toContain('data-type="raw-html-block"')
    expect(html).toContain('<h3>Agent 模式</h3>')
    expect(html).not.toContain('&#10;### Agent 模式')
  })

  test('normalizes invisible heading prefixes after media', () => {
    const html = markdownToHtml([
      '![晨光](晨光.jpg)',
      '\u200b### Agent 模式',
    ].join('\n'))

    expect(html).toContain('<h3>Agent 模式</h3>')
  })

  test('parses angle image destinations with local path characters', () => {
    const html = markdownToHtml('![晨光](<foo bar/晨光 (1)#a.jpg>)')

    expect(html).toContain('<img')
    expect(html).toContain('src="foo%20bar/%E6%99%A8%E5%85%89%20(1)#a.jpg"')
    expect(html).toContain('alt="晨光"')
  })

  test('does not preprocess fenced code blocks as markdown content', () => {
    const html = markdownToHtml([
      '```md',
      '<img src="晨光.jpg">',
      '### Agent 模式',
      '\u200b### Hidden',
      '```',
    ].join('\n'))

    expect(html).toContain('&lt;img src=&quot;晨光.jpg&quot;&gt;')
    expect(html).toContain('### Agent 模式')
    expect(html).toContain('\u200b### Hidden')
    expect(html).not.toContain('<h3>Agent 模式</h3>')
    expect(html).not.toContain('<h3>Hidden</h3>')
  })

  test('does not preprocess indented code blocks as markdown content', () => {
    const html = markdownToHtml([
      '    <img src="晨光.jpg">',
      '    ### Agent 模式',
    ].join('\n'))

    expect(html).toContain('&lt;img src=&quot;晨光.jpg&quot;&gt;')
    expect(html).toContain('### Agent 模式')
    expect(html).not.toContain('<h3>Agent 模式</h3>')
  })
})

describe('linkify 合成链接防护', () => {
  test('markdownToHtml 不把 SKILL.md 文件名误判为 URL 链接', () => {
    const html = markdownToHtml('请查看 SKILL.md 了解更多')
    expect(html).not.toContain('http://SKILL.md')
    expect(html).not.toContain('<a')
  })

  test('markdownToHtml 仍对带 scheme 的真实 URL 自动链接', () => {
    const html = markdownToHtml('访问 https://example.com 了解更多')
    expect(html).toContain('<a href="https://example.com">')
  })

  test('markdownToHtml 不把裸域名 google.com 误判为链接', () => {
    const html = markdownToHtml('访问 google.com 搜索')
    expect(html).not.toContain('<a')
  })

  test('markdownToHtml 不把裸邮箱 foo@bar.com 误判为 mailto 链接', () => {
    const html = markdownToHtml('联系 foo@bar.com')
    expect(html).not.toContain('mailto:')
    expect(html).not.toContain('<a')
    expect(html).toContain('foo@bar.com')
  })
})
