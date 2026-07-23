import { describe, expect, test } from 'bun:test'
import { copyImageSourceToClipboard } from './image-clipboard'

describe('图片复制', () => {
  test('data URL 直接交给主进程复制', async () => {
    const source = 'data:image/png;base64,AAAA'
    const copied: string[] = []

    const result = await copyImageSourceToClipboard(source, async (dataUrl) => {
      copied.push(dataUrl)
      return { success: true }
    })

    expect(result).toEqual({ success: true })
    expect(copied).toEqual([source])
  })

  test('图片读取失败时返回用户可见错误', async () => {
    const result = await copyImageSourceToClipboard(
      'file:///missing.png',
      async () => ({ success: true }),
      async () => { throw new Error('missing') },
    )

    expect(result).toEqual({ success: false, message: '复制失败，请检查图片是否可访问' })
  })

  test('IPC 拒绝时返回用户可见错误', async () => {
    const result = await copyImageSourceToClipboard(
      'data:image/png;base64,AAAA',
      async () => { throw new Error('clipboard denied') },
    )

    expect(result).toEqual({ success: false, message: '复制失败，请检查图片是否可访问' })
  })

  test('主进程失败且未提供原因时使用默认错误', async () => {
    const result = await copyImageSourceToClipboard(
      'data:image/png;base64,AAAA',
      async () => ({ success: false }),
    )

    expect(result).toEqual({ success: false, message: '复制失败' })
  })
})
