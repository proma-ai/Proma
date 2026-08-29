import { describe, expect, it } from 'bun:test'
import { canBrowserSessionTakeForeground, isNewBrowserTabLayoutRevision } from './browser-presentation-policy'

describe('isNewBrowserTabLayoutRevision', () => {
  it('场景：收到更大的 revision → 接受新布局', () => {
    expect(isNewBrowserTabLayoutRevision(12, 11)).toBe(true)
  })

  it('边界：相同或更小的 revision → 拒绝旧布局', () => {
    expect(isNewBrowserTabLayoutRevision(12, 12)).toBe(false)
    expect(isNewBrowserTabLayoutRevision(11, 12)).toBe(false)
  })
})

describe('canBrowserSessionTakeForeground', () => {
  it('场景：同一 session 的新布局 → 允许双 Pane 独立更新', () => {
    expect(canBrowserSessionTakeForeground({
      incomingSessionId: 'session-a',
      foregroundSessionId: 'session-a',
      revision: 10,
      latestForegroundRevision: 20,
    })).toBe(true)
  })

  it('边界：其他 session 的旧布局 → 不得抢回前台', () => {
    expect(canBrowserSessionTakeForeground({
      incomingSessionId: 'session-b',
      foregroundSessionId: 'session-a',
      revision: 10,
      latestForegroundRevision: 20,
    })).toBe(false)
  })
})
