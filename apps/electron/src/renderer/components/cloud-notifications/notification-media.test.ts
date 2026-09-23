import { describe, expect, test } from 'bun:test'
import { getNotificationMediaLayout, resolveNotificationMedia } from './notification-media'

const notification = {
  id: 'notice-1',
  title: 'Proma 更新',
  bodyMarkdown: '这是一段文案。',
  platform: 'all',
  publishedAt: '2026-09-23T02:00:00Z',
}

describe('通知主视觉解析', () => {
  test('无媒体和旧服务端响应保持正文单栏', () => {
    expect(resolveNotificationMedia(notification)).toBeNull()
    expect(resolveNotificationMedia({ ...notification, mediaUrl: null, mediaType: null })).toBeNull()
  })

  test('图片与带签名参数的视频按显式类型解析，不依赖扩展名', () => {
    expect(resolveNotificationMedia({ ...notification, mediaType: 'image', mediaUrl: 'https://cdn.example.com/banner' }))
      .toEqual({ type: 'image', url: 'https://cdn.example.com/banner' })
    expect(resolveNotificationMedia({ ...notification, mediaType: 'video', mediaUrl: 'https://cdn.example.com/play?id=1' }))
      .toEqual({ type: 'video', url: 'https://cdn.example.com/play?id=1' })
  })

  test('根据自然比例为竖图收窄媒体列，横图放宽，但为文案留出空间', () => {
    const portrait = getNotificationMediaLayout(600, 900)
    const landscape = getNotificationMediaLayout(1600, 900)
    expect(portrait.mediaColumnWidth).toBeLessThan(landscape.mediaColumnWidth)
    expect(portrait.dialogWidth).toBeLessThan(landscape.dialogWidth)
    expect(portrait.mediaColumnWidth).toBeGreaterThanOrEqual(200)
    expect(landscape.mediaColumnWidth).toBeGreaterThanOrEqual(530)
    expect(landscape.mediaColumnWidth).toBeLessThanOrEqual(600)
    expect(landscape.dialogWidth).toBeLessThanOrEqual(1120)
    // 16:9 主图不再为白边预留 32px，在大窗口里约 300px 高。
    const imageWidth = Math.min(landscape.mediaColumnWidth, landscape.dialogWidth * 0.57, landscape.dialogWidth - 320)
    expect(imageWidth * 900 / 1600).toBeGreaterThanOrEqual(295)
    expect(landscape.dialogWidth - landscape.mediaColumnWidth).toBeGreaterThanOrEqual(440)
    const narrowDialogWidth = 800 - 48 // w-[calc(100vw-3rem)]
    const narrowColumnWidth = Math.min(landscape.mediaColumnWidth, narrowDialogWidth * 0.57, narrowDialogWidth - 320)
    expect(narrowColumnWidth * 900 / 1600).toBeGreaterThanOrEqual(220)
    expect(narrowDialogWidth - narrowColumnWidth).toBeGreaterThanOrEqual(320)
    expect(getNotificationMediaLayout(200, 200).mediaColumnWidth).toBe(200)
    expect(getNotificationMediaLayout(0, 0)).toEqual(getNotificationMediaLayout(400, 400))
  })

  test('16:9 视频获得比同尺寸图片更宽的媒体列，竖版视频仍保持紧凑', () => {
    const image = getNotificationMediaLayout(1920, 1080)
    const video = getNotificationMediaLayout(1920, 1080, 'video')
    const portraitVideo = getNotificationMediaLayout(720, 1280, 'video')
    expect(video.mediaColumnWidth).toBeGreaterThan(image.mediaColumnWidth)
    expect(video.dialogWidth).toBeGreaterThan(image.dialogWidth)
    expect(video.dialogWidth).toBeLessThanOrEqual(1080)
    expect(portraitVideo.mediaColumnWidth).toBeLessThan(video.mediaColumnWidth)
    expect(getNotificationMediaLayout(1000, 1000, 'video').mediaColumnWidth).toBe(360) // 没有内层 p-4
  })

  test('不完整或不安全的媒体字段不进入渲染', () => {
    for (const mediaUrl of ['http://example.com/a.png', 'javascript:alert(1)', 'https://user:pass@example.com/a.png', 'https://example.com/a b.png', 'https://']) {
      expect(resolveNotificationMedia({ ...notification, mediaType: 'image', mediaUrl })).toBeNull()
    }
    expect(resolveNotificationMedia({ ...notification, mediaType: 'image', mediaUrl: null })).toBeNull()
    expect(resolveNotificationMedia({ ...notification, mediaType: null, mediaUrl: 'https://example.com/a.png' })).toBeNull()
  })
})
