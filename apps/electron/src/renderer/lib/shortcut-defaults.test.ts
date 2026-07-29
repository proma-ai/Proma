import { describe, expect, test } from 'bun:test'
import { DEFAULT_SHORTCUTS } from './shortcut-defaults'

describe('native zoom shortcuts', () => {
  test('includes readonly zoom controls for every Electron menu role', () => {
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'zoom-in')).toMatchObject({
      defaultMac: 'Cmd+Plus',
      defaultWin: 'Ctrl+Plus',
      readonly: true,
    })
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'zoom-out')).toMatchObject({
      defaultMac: 'Cmd+Minus',
      defaultWin: 'Ctrl+Minus',
      readonly: true,
    })
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'reset-zoom')).toMatchObject({
      defaultMac: 'Cmd+0',
      defaultWin: 'Ctrl+0',
      readonly: true,
    })
  })
})
