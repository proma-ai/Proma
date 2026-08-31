import * as React from 'react'

interface SearchMatchHighlightProps {
  before: string
  match: string
  after: string
}

/** 搜索结果中的实际命中文本，使用与消息跳转一致的语义色。 */
export function SearchMatchHighlight({
  before,
  match,
  after,
}: SearchMatchHighlightProps): React.ReactElement {
  return (
    <>
      {before}
      <mark className="rounded-sm bg-[hsl(var(--search-highlight-background))] px-0.5 text-[hsl(var(--search-highlight-foreground))]">
        {match}
      </mark>
      {after}
    </>
  )
}
