import { describe, expect, test } from 'bun:test'
import { markdownToHtml } from './markdown-rich-text'

describe('markdownToHtml rich preview blocks', () => {
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
