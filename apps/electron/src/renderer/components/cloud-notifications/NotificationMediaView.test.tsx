import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotificationMediaView } from './CloudNotificationDialog'

describe('通知主视觉组件', () => {
  test('图片无内边距、描边和独立圆角，按固有比例的舞台贴边铺满', () => {
    const html = renderToStaticMarkup(
      <NotificationMediaView title="新功能" media={{ type: 'image', url: 'https://cdn.example.com/banner.png' }} aspectRatio={16 / 9} />,
    )
    expect(html).toContain('aria-label="通知媒体"')
    expect(html).toContain('alt="新功能"')
    expect(html).toContain('aspect-ratio:1.777')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('object-cover')
    expect(html).toContain('h-full w-full')
    expect(html).not.toContain('p-4')
    expect(html).not.toContain('ring-1')
    expect(html).not.toContain('rounded-lg')
    expect(html).not.toContain('aspect-[4/3]')
    expect(html).not.toContain('bg-background/70')
    expect(html).toContain('src="https://cdn.example.com/banner.png"')
  })

  test('视频可手动播放但不会自动播放', () => {
    const html = renderToStaticMarkup(
      <NotificationMediaView title="演示" media={{ type: 'video', url: 'https://cdn.example.com/video?token=1' }} />,
    )
    expect(html).toContain('controls=""')
    expect(html).toContain('preload="metadata"')
    expect(html).toContain('p-4')
    expect(html).toContain('min-h-[min(50vh,300px)]')
    expect(html).toContain('max-h-[min(70vh,520px)]')
    expect(html).toContain('object-contain')
    expect(html).not.toContain('autoplay')
    expect(html).toContain('aria-label="演示的视频"')
  })
})
