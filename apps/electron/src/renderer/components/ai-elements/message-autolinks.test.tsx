import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkTrimCjkAutolinks } from './message'

function render(input: string): string {
  return renderToStaticMarkup(<Markdown remarkPlugins={[remarkGfm, remarkTrimCjkAutolinks]}>{input}</Markdown>)
}

test('Given an Agent bare URL followed by Chinese punctuation When rendered Then the prose stays outside the clickable link', () => {
  const html = render('URL：https://github.com/proma-ai/Proma/blob/main/README.en.md；摘要：Proma')
  expect(html).toContain('href="https://github.com/proma-ai/Proma/blob/main/README.en.md"')
  expect(html).toContain('README.en.md</a>；摘要：Proma')
})

test('Given an explicit Markdown link When rendered Then its intentional URL is preserved', () => {
  const html = render('[官方](https://example.com/a；b)')
  expect(html).toContain('href="https://example.com/a%EF%BC%9Bb"')
})

test('Given an explicit Markdown link whose label is also its URL When rendered Then its intentional URL is preserved', () => {
  const html = render('[https://example.com/a；b](https://example.com/a；b)')
  expect(html).toContain('href="https://example.com/a%EF%BC%9Bb"')
})

test('Given a fenced code URL When rendered Then the source text is not changed', () => {
  const html = render('```text\nhttps://example.com/a；后文\n```')
  expect(html).toContain('https://example.com/a；后文')
  expect(html).not.toContain('<a')
})
