import { describe, expect, test } from 'bun:test'
import { copyTextToClipboard } from './clipboard'

describe('消息文本复制', () => {
  test('优先使用 Electron 主进程剪贴板', async () => {
    const calls: string[] = []

    await copyTextToClipboard('消息内容', {
      native: async (text) => { calls.push(`native:${text}`) },
      browser: async (text) => { calls.push(`browser:${text}`) },
    })

    expect(calls).toEqual(['native:消息内容'])
  })

  test('主进程复制失败时回退到 renderer 剪贴板', async () => {
    const calls: string[] = []

    await copyTextToClipboard('消息内容', {
      native: async () => { throw new Error('native clipboard unavailable') },
      browser: async (text) => { calls.push(`browser:${text}`) },
    })

    expect(calls).toEqual(['browser:消息内容'])
  })

  test('没有可用剪贴板实现时抛出错误', async () => {
    await expect(copyTextToClipboard('消息内容', {})).rejects.toThrow('当前环境不支持写入剪贴板')
  })
})
