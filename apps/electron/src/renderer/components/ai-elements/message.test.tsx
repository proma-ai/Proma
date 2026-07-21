import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageResponse } from './message'

function renderMessage(markdown: string): string {
  return renderToStaticMarkup(<MessageResponse>{markdown}</MessageResponse>)
}

describe('MessageResponse local file Markdown links', () => {
  test('renders the reported absolute path with a line suffix as a file chip', () => {
    const href = '/Users/bigmouth/Workspace/Project/Proma/apps/electron/src/renderer/components/agent/ContextUsageBadge.tsx:247'
    const html = renderMessage(`[ContextUsageBadge.tsx](${href})`)

    expect(html).toContain('<button')
    expect(html).toContain('ContextUsageBadge.tsx:247')
    expect(html).not.toContain(`<a href="${href}"`)
  })

  test('keeps Windows absolute file paths through URL sanitization and renders a file chip', () => {
    const href = 'C:/Workspace/Proma/apps/electron/src/message.tsx:247'
    const html = renderMessage(`[message.tsx](${href})`)

    expect(html).toContain('<button')
    expect(html).toContain('message.tsx:247')
    expect(html).not.toContain('<a')
  })

  test('keeps HTTP links as external links', () => {
    const html = renderMessage('[Proma](https://proma.ai)')

    expect(html).toContain('href="https://proma.ai"')
    expect(html).not.toContain('<button')
  })

  test('keeps mention links as mention chips', () => {
    const html = renderMessage('[file](mention://file/%2Ftmp%2Fexample.ts)')

    expect(html).toContain('example.ts')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('<button')
  })
})
