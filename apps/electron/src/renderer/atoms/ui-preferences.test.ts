import { afterEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../../types'
import { initializeUiPreferences, updateRenderInputAsRichTextEnabled } from './ui-preferences'

interface TestElectronAPI {
  getSettings: () => Promise<Partial<AppSettings>>
  updateSettings: (updates: Partial<AppSettings>) => Promise<Partial<AppSettings>>
}

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setTestWindow(electronAPI: TestElectronAPI): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { electronAPI },
  })
}

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

test('initializeUiPreferences 默认开启输入框富文本渲染', async () => {
  setTestWindow({
    getSettings: async () => ({}),
    updateSettings: mock(async (updates: Partial<AppSettings>) => updates),
  })

  let renderInputAsRichTextEnabled = false
  await initializeUiPreferences(
    () => {},
    undefined,
    (enabled) => {
      renderInputAsRichTextEnabled = enabled
    }
  )

  expect(renderInputAsRichTextEnabled).toBe(true)
})

test('initializeUiPreferences 读取关闭的输入框富文本渲染设置', async () => {
  setTestWindow({
    getSettings: async () => ({ renderInputAsRichTextEnabled: false }),
    updateSettings: mock(async (updates: Partial<AppSettings>) => updates),
  })

  let renderInputAsRichTextEnabled = true
  await initializeUiPreferences(
    () => {},
    undefined,
    (enabled) => {
      renderInputAsRichTextEnabled = enabled
    }
  )

  expect(renderInputAsRichTextEnabled).toBe(false)
})

test('updateRenderInputAsRichTextEnabled 持久化关闭状态', async () => {
  const updateSettings = mock(async (updates: Partial<AppSettings>) => updates)
  setTestWindow({
    getSettings: async () => ({}),
    updateSettings,
  })

  await updateRenderInputAsRichTextEnabled(false)

  expect(updateSettings).toHaveBeenCalledWith({ renderInputAsRichTextEnabled: false })
})
