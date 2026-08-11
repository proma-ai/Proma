import { describe, expect, test } from 'bun:test'
import { getTabBarActionLayout } from './tab-bar-action-layout'

describe('TabBar action layout', () => {
  test('given Windows without a panel button, keeps FAQ and shortcuts inside the tab bar before window controls', () => {
    expect(getTabBarActionLayout(true, false)).toEqual({
      scrollPaddingClassName: 'pr-[190px]',
      shortcutPositionClassName: 'inset-y-0 items-end pb-[3px] z-10 right-[130px]',
      panelPositionClassName: 'inset-y-0 right-[126px] items-end pb-[3px] z-10',
    })
  })

  test('given Windows with a panel button, reserves space for all three actions without moving them below the tab bar', () => {
    expect(getTabBarActionLayout(true, true)).toEqual({
      scrollPaddingClassName: 'pr-[218px]',
      shortcutPositionClassName: 'inset-y-0 items-end pb-[3px] z-10 right-[158px]',
      panelPositionClassName: 'inset-y-0 right-[126px] items-end pb-[3px] z-10',
    })
  })

  test('given macOS, preserves the compact right-aligned tab bar actions', () => {
    expect(getTabBarActionLayout(false, true)).toEqual({
      scrollPaddingClassName: 'pr-20',
      shortcutPositionClassName: 'inset-y-0 items-end pb-[3px] z-10 right-9',
      panelPositionClassName: 'inset-y-0 right-1 items-end pb-[3px] z-10',
    })
  })
})
