import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageResponse, UserMessageContent } from './message'

function renderMessage(markdown: string): string {
  return renderToStaticMarkup(<MessageResponse>{markdown}</MessageResponse>)
}

function renderUserMessage(markdown: string): string {
  return renderToStaticMarkup(<UserMessageContent>{markdown}</UserMessageContent>)
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

  test('renders persisted titles for named planning and session references', () => {
    const markdown = [
      `&todo:todo-123::${encodeURIComponent('输入框改造')}`,
      `&calendar_event:event-456::${encodeURIComponent('产品评审')}`,
      `&session:session-789::${encodeURIComponent('修复引用显示')}`,
    ].join(' ')
    const html = renderUserMessage(markdown)

    expect(html).toContain('输入框改造')
    expect(html).toContain('产品评审')
    expect(html).toContain('修复引用显示')
    expect(html).not.toContain('todo-123')
    expect(html).not.toContain('session-789')
  })

  test('renders legacy labels without GFM strikethrough splitting adjacent references', () => {
    const html = renderUserMessage('&todo:todo-123~1111 &session:session-789~2222')

    expect(html).toContain('1111')
    expect(html).toContain('2222')
    expect(html).not.toContain('Todo todo-123')
    expect(html).not.toContain('会话 session-')
  })

  test('preserves legacy token text in inline and fenced code', () => {
    const html = renderUserMessage([
      '`&todo:todo-123~1111`',
      '',
      '```text',
      '&session:session-789~2222',
      '```',
      '',
      '&todo:todo-456~3333',
    ].join('\n'))

    expect(html).toContain('todo-123~1111')
    expect(html).toContain('session-789~2222')
    expect(html).toContain('3333')
    expect(html).not.toContain('Todo todo-123')
    expect(html).not.toContain('会话 session-')
  })

  test('keeps legacy named references readable when they only contain an id', () => {
    const html = renderUserMessage('&todo:todo-123 &session:session-789')

    expect(html).toContain('Todo todo-123')
    expect(html).toContain('会话 session-')
  })
})
