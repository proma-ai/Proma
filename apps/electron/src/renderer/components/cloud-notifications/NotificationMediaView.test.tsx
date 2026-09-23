import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotificationMediaView } from './CloudNotificationDialog'

describe('通知主视觉组件', () => {
  test('图片以完整比例显示在独立舞台，具备可访问名称', () => {
    const html = renderToStaticMarkup(
      <NotificationMediaView title="新功能" media={{ type: 'image', url: 'https://cdn.example.com/banner.png' }} />,
    )
    expect(html).toContain('aria-label="通知媒体"')
    expect(html).toContain('alt="新功能"')
    expect(html).toContain('object-contain')
    expect(html).toContain('src="https://cdn.example.com/banner.png"')
  })

  test('视频可手动播放但不会自动播放', () => {
    const html = renderToStaticMarkup(
      <NotificationMediaView title="演示" media={{ type: 'video', url: 'https://cdn.example.com/video?token=1' }} />,
    )
    expect(html).toContain('controls=""')
    expect(html).toContain('preload="metadata"')
    expect(html).not.toContain('autoplay')
    expect(html).toContain('aria-label="演示的视频"')
  })
})
