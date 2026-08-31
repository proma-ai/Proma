import { describe, expect, test } from 'bun:test'
import {
  applyMessageSearchHighlight,
  attemptMessageSearchNavigation,
  createMessageSearchNavigation,
  createMessageSearchNavigationState,
  reduceMessageSearchNavigationState,
  resolveMessageSearchAnchorId,
  resolveMessageSearchTextRange,
} from './message-search-navigation'

describe('全局搜索结果消息定位', () => {
  test('Given Chat 或 Agent 正文结果 When 创建导航请求 Then 保留会话类型和精确匹配上下文', () => {
    expect(createMessageSearchNavigation({
      type: 'chat',
      id: 'chat-1',
      messageId: 'message-2',
      snippet: '第二段的目标词在这里',
      matchStart: 4,
      matchLength: 3,
      updatedAt: 10,
      title: 'Chat',
    }, '目标词')).toEqual({
      sessionType: 'chat',
      sessionId: 'chat-1',
      messageId: 'message-2',
      query: '目标词',
      snippet: '第二段的目标词在这里',
      matchStart: 4,
      matchLength: 3,
    })
  })

  test('Given 同一 Agent 回复由多条持久化消息组成 When 解析锚点 Then 定位到页面消息组', () => {
    expect(resolveMessageSearchAnchorId([
      { anchorId: 'assistant-first', messageIds: ['assistant-first', 'assistant-later'] },
    ], 'assistant-later')).toBe('assistant-first')
  })

  test('Given 页面同一关键词出现多次 When 解析高亮范围 Then 使用摘要上下文选择正确位置', () => {
    const renderedText = '第一段的目标词不是它。第二段的目标词才是搜索结果。'
    const range = resolveMessageSearchTextRange(renderedText, {
      query: '目标词',
      snippet: '第二段的目标词才是搜索结果。',
      matchStart: 4,
      matchLength: 3,
    })

    expect(range?.matchStart).toBe(renderedText.lastIndexOf('目标词'))
  })

  test('Given 定位请求已应用 When 标记为激活 Then 清除待处理请求并保留高亮归属', () => {
    const navigation = {
      sessionType: 'agent' as const,
      sessionId: 'agent-1',
      messageId: 'message-1',
      query: '目标词',
      snippet: '目标词',
      matchStart: 0,
      matchLength: 3,
    }
    const requested = reduceMessageSearchNavigationState(
      createMessageSearchNavigationState(),
      { type: 'request', navigation },
    )

    expect(reduceMessageSearchNavigationState(requested, { type: 'activate', navigation })).toEqual({
      pendingNavigation: null,
      activeHighlight: navigation,
    })
  })

  test('Given Agent 高亮处于激活状态 When 其他 Chat 卸载 Then 不清除目标高亮', () => {
    const navigation = {
      sessionType: 'agent' as const,
      sessionId: 'agent-1',
      messageId: 'message-1',
      query: '目标词',
      snippet: '目标词',
      matchStart: 0,
      matchLength: 3,
    }
    const activeState = { pendingNavigation: null, activeHighlight: navigation }

    expect(reduceMessageSearchNavigationState(activeState, {
      type: 'leave-session',
      sessionType: 'chat',
      sessionId: 'chat-1',
    })).toEqual(activeState)
    expect(reduceMessageSearchNavigationState(activeState, {
      type: 'leave-session',
      sessionType: 'agent',
      sessionId: 'agent-1',
    })).toEqual(createMessageSearchNavigationState())
  })

  test('Given Chat 目标消息尚未加载且仍有历史 When 尝试定位 Then 触发加载并保留请求', () => {
    let loadCount = 0
    const result = attemptMessageSearchNavigation({
      navigation: {
        sessionType: 'chat',
        sessionId: 'chat-1',
        messageId: 'old-message',
        query: '目标词',
        snippet: '目标词',
        matchStart: 0,
        matchLength: 3,
      },
      findTarget: () => null,
      canRetry: true,
      retry: () => { loadCount++ },
      scrollToTarget: () => {},
      highlightTarget: () => false,
    })

    expect(result).toBe('pending')
    expect(loadCount).toBe(1)
  })

  test('Given 目标 DOM 已渲染且 CSS Highlight 可用 When 应用搜索定位 Then 创建精确 Range', () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const originalNodeFilter = Object.getOwnPropertyDescriptor(globalThis, 'NodeFilter')
    const originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
    const originalHighlight = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
    const rangeCalls: Array<[string, number]> = []
    const textNode = { textContent: '前缀目标词后缀' } as Node
    const ranges: unknown[] = []
    try {
      Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, value: { SHOW_TEXT: 4 } })
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
          createTreeWalker: () => {
            let visited = false
            return { nextNode: () => visited ? null : (visited = true, textNode) }
          },
          createRange: () => ({
            setStart: (_node: Node, offset: number) => rangeCalls.push(['start', offset]),
            setEnd: (_node: Node, offset: number) => rangeCalls.push(['end', offset]),
          }),
        },
      })
      Object.defineProperty(globalThis, 'CSS', {
        configurable: true,
        value: { highlights: { set: (_name: string, range: unknown) => ranges.push(range), delete: () => true } },
      })
      Object.defineProperty(globalThis, 'Highlight', {
        configurable: true,
        value: class FakeHighlight { constructor(...createdRanges: unknown[]) { ranges.push(...createdRanges) } },
      })

      const applied = applyMessageSearchHighlight(
        { textContent: '前缀目标词后缀' } as HTMLElement,
        {
          sessionType: 'chat',
          sessionId: 'chat-1',
          messageId: 'message-1',
          query: '目标词',
          snippet: '前缀目标词后缀',
          matchStart: 2,
          matchLength: 3,
        },
      )

      expect(applied).toBe(true)
      expect(rangeCalls).toEqual([['start', 2], ['end', 5]])
      expect(ranges.length).toBeGreaterThan(0)
    } finally {
      restoreGlobal('document', originalDocument)
      restoreGlobal('NodeFilter', originalNodeFilter)
      restoreGlobal('CSS', originalCss)
      restoreGlobal('Highlight', originalHighlight)
    }
  })

  test('Given CSS Highlight API 不可用 When 应用搜索定位 Then 安全返回失败', () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const originalNodeFilter = Object.getOwnPropertyDescriptor(globalThis, 'NodeFilter')
    const originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
    const textNode = { textContent: '目标词' } as Node
    try {
      Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, value: { SHOW_TEXT: 4 } })
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
          createTreeWalker: () => {
            let visited = false
            return { nextNode: () => visited ? null : (visited = true, textNode) }
          },
          createRange: () => ({ setStart: () => {}, setEnd: () => {} }),
        },
      })
      Object.defineProperty(globalThis, 'CSS', { configurable: true, value: {} })

      expect(applyMessageSearchHighlight(
        { textContent: '目标词' } as HTMLElement,
        {
          sessionType: 'agent',
          sessionId: 'agent-1',
          messageId: 'message-1',
          query: '目标词',
          snippet: '目标词',
          matchStart: 0,
          matchLength: 3,
        },
      )).toBe(false)
    } finally {
      restoreGlobal('document', originalDocument)
      restoreGlobal('NodeFilter', originalNodeFilter)
      restoreGlobal('CSS', originalCss)
    }
  })
})

function restoreGlobal(key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor)
  else Reflect.deleteProperty(globalThis, key)
}
