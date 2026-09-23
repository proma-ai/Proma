import { describe, expect, test } from 'bun:test'
import { resolveNotificationMedia } from './notification-media'

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

  test('不完整或不安全的媒体字段不进入渲染', () => {
    for (const mediaUrl of ['http://example.com/a.png', 'javascript:alert(1)', 'https://user:pass@example.com/a.png', 'https://example.com/a b.png', 'https://']) {
      expect(resolveNotificationMedia({ ...notification, mediaType: 'image', mediaUrl })).toBeNull()
    }
    expect(resolveNotificationMedia({ ...notification, mediaType: 'image', mediaUrl: null })).toBeNull()
    expect(resolveNotificationMedia({ ...notification, mediaType: null, mediaUrl: 'https://example.com/a.png' })).toBeNull()
  })
})
