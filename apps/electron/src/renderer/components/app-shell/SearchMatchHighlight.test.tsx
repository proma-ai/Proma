import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SearchMatchHighlight } from './SearchMatchHighlight'

describe('搜索结果匹配高亮', () => {
  test('Given 全局或项目搜索结果 When 渲染命中 Then 使用与消息跳转相同的搜索语义色', () => {
    const html = renderToStaticMarkup(
      <SearchMatchHighlight before="前" match="命中" after="后" />,
    )

    expect(html).toContain('--search-highlight-background')
    expect(html).toContain('--search-highlight-foreground')
    expect(html).toContain('<mark')
  })
})
