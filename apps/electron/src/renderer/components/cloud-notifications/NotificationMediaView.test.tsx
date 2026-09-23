import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import { NotificationMediaView, markdownComponents, toggleNotificationVideoPlayback } from './CloudNotificationDialog'

describe('通知主视觉组件', () => {
  test('图片无内边距、描边和独立圆角，按固有比例的舞台贴边铺满', () => {
    const html = renderToStaticMarkup(
      <NotificationMediaView title="新功能" media={{ type: 'image', url: 'https://cdn.example.com/banner.png' }} aspectRatio={16 / 9} />,
    )
    expect(html).toContain('aria-label="通知媒体"')
    expect(html).toContain('alt="新功能"')
    expect(html).toContain('aspect-ratio:1.777')
    expect(html).toContain('min-w-0 w-full')
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

  test('主视觉视频静音自动循环，只显示播放暂停按钮', () => {
    const html = renderToStaticMarkup(
      <NotificationMediaView title="演示" media={{ type: 'video', url: 'https://cdn.example.com/video?token=1' }} aspectRatio={16 / 9} />,
    )
    const videoTag = html.match(/<video\b[^>]*>/)?.[0]
    expect(videoTag).toBeDefined()
    expect(videoTag).toContain('autoplay=""')
    expect(videoTag).toContain('muted=""')
    expect(videoTag).toContain('loop=""')
    expect(videoTag).toContain('playsinline=""')
    expect(videoTag).not.toContain(' controls=')
    expect(videoTag).toContain('preload="metadata"')
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).toContain('aria-label="播放视频"')
    expect(html).toContain('min-w-0 w-full')
    expect(html).toContain('aspect-ratio:1.777')
    expect(html).toContain('min-h-[min(50vh,300px)]')
    expect(html).toContain('max-height:min(70vh, 520px)')
    expect(html).toContain('object-cover')
    expect(html).not.toContain('p-4')
    expect(html).not.toContain('ring-1')
    expect(html).not.toContain('rounded-lg')
    expect(html).toContain('aria-label="演示的视频"')
  })

  test('播放暂停操作能正确切换，播放受阻时不产生未处理异常', async () => {
    let playCount = 0
    let pauseCount = 0
    const video = {
      paused: true,
      play: async () => { playCount++ },
      pause: () => { pauseCount++ },
    }
    await toggleNotificationVideoPlayback(video)
    expect(playCount).toBe(1)
    expect(pauseCount).toBe(0)
    video.paused = false
    await toggleNotificationVideoPlayback(video)
    expect(pauseCount).toBe(1)
    video.paused = true
    video.play = async () => { throw new Error('autoplay blocked') }
    await expect(toggleNotificationVideoPlayback(video)).resolves.toBeUndefined()
  })

  test('旧 Markdown 正文内嵌视频也自动循环且无原生控制条', () => {
    const html = renderToStaticMarkup(
      <Markdown components={markdownComponents}>![video](https://cdn.example.com/demo.mp4)</Markdown>,
    )
    const videoTag = html.match(/<video\b[^>]*>/)?.[0]
    expect(videoTag).toContain('autoplay=""')
    expect(videoTag).toContain('muted=""')
    expect(videoTag).toContain('loop=""')
    expect(videoTag).not.toContain(' controls=')
    expect(html).toContain('<p><span class="relative my-3 block') // Markdown 图片位于段落内，不能插入 div
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).toContain('aria-label="播放视频"')
    expect(html).not.toContain('border border-border')
    expect(html).not.toContain('rounded-lg')
  })
})
