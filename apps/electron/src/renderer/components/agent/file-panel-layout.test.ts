import { describe, expect, test } from 'bun:test'
import { WIDE_FILE_PANEL_MIN_WIDTH, shouldShowBothFileSources } from './file-panel-layout'

describe('右侧文件面板宽度布局', () => {
  test('达到阈值时同时展示会话文件和项目文件', () => {
    expect(shouldShowBothFileSources(WIDE_FILE_PANEL_MIN_WIDTH)).toBe(true)
    expect(shouldShowBothFileSources(WIDE_FILE_PANEL_MIN_WIDTH + 1)).toBe(true)
  })

  test('低于阈值时保留单来源切换模式', () => {
    expect(shouldShowBothFileSources(WIDE_FILE_PANEL_MIN_WIDTH - 1)).toBe(false)
  })
})
