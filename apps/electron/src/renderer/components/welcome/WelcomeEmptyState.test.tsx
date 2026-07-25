import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WelcomeEmptyState } from './WelcomeEmptyState'

function renderWelcome(showModeSwitcher?: boolean): string {
  return renderToStaticMarkup(<WelcomeEmptyState showModeSwitcher={showModeSwitcher} />)
}

describe('WelcomeEmptyState 模式入口', () => {
  test('Given 主界面空状态 When 未指定模式入口 Then 保留 Agent 和 Chat 切换', () => {
    const html = renderWelcome()

    expect(html).toContain('>Agent<')
    expect(html).toContain('>Chat<')
  })

  test('Given 右侧问答空状态 When 禁用模式入口 Then 不渲染全局 Agent 或 Chat 切换', () => {
    const html = renderWelcome(false)

    expect(html).not.toContain('>Agent<')
    expect(html).not.toContain('>Chat<')
  })
})
