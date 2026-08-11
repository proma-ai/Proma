import { describe, expect, test } from 'bun:test'
import {
  focusScratchPadTab,
  SCRATCH_PAD_ID,
  type TabItem,
} from './tab-atoms'

function createAgentTab(id = 'agent-1'): TabItem {
  return {
    id,
    type: 'agent',
    sessionId: id,
    title: 'Agent 会话',
  }
}

describe('Scratch Pad Tab 恢复', () => {
  test('given 草稿已拖到右侧分屏 when Ctrl+Tab 聚焦草稿 then 恢复完整草稿并关闭分屏', () => {
    const result = focusScratchPadTab([
      createAgentTab(),
      {
        id: '__preview__:agent-1',
        type: 'preview',
        sessionId: 'agent-1',
        title: '预览：README.md',
      },
    ])

    expect(result.activeTabId).toBe(SCRATCH_PAD_ID)
    expect(result.scratchPanelOpen).toBe(false)
    expect(result.tabs.map((tab) => tab.id)).toEqual([
      SCRATCH_PAD_ID,
      'agent-1',
      '__preview__:agent-1',
    ])
  })

  test('given 顶部已有固定草稿 when 再次聚焦 then 不重复创建草稿标签', () => {
    const existingScratch: TabItem = {
      id: SCRATCH_PAD_ID,
      type: 'scratch',
      sessionId: SCRATCH_PAD_ID,
      title: 'Scratch Pad',
    }

    const result = focusScratchPadTab([existingScratch, createAgentTab()])

    expect(result.tabs.filter((tab) => tab.id === SCRATCH_PAD_ID)).toEqual([existingScratch])
    expect(result.scratchPanelOpen).toBe(false)
  })
})
