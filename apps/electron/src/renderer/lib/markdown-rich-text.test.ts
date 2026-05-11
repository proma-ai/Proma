import { describe, expect, test } from 'bun:test'
import { markdownToHtml } from './markdown-rich-text'

describe('markdownToHtml rich preview blocks', () => {
  test('wraps markdown tables as preview blocks while preserving the source markdown', () => {
    const html = markdownToHtml([
      '| Header 1 | Header 2 |',
      '| --- | --- |',
      '| Cell 1 | Cell 2 |',
    ].join('\n'))

    expect(html).toContain('data-type="markdown-table"')
    expect(html).toContain('data-markdown="| Header 1 | Header 2 |&#10;| --- | --- |&#10;| Cell 1 | Cell 2 |"')
    expect(html).toContain('&lt;table&gt;')
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
})
