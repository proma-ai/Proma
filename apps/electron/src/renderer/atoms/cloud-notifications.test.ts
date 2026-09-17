import { describe, expect, test } from 'bun:test'
import { mergeCloudNotifications } from './cloud-notifications'

const earlier = {
  id: 'earlier',
  title: '较早通知',
  bodyMarkdown: '内容',
  platform: 'desktop',
  publishedAt: '2026-09-17T08:00:00Z',
}

const later = {
  id: 'later',
  title: '较晚通知',
  bodyMarkdown: '内容',
  platform: 'desktop',
  publishedAt: '2026-09-17T09:00:00Z',
}

describe('Cloud notification queue', () => {
  test('Given multiple notification snapshots arriving out of order When merged Then presents each notification once in publication order', () => {
    expect(mergeCloudNotifications([later], [earlier], [later])).toEqual([earlier, later])
  })

  test('Given a later snapshot for an existing notification When merged Then retains the latest payload', () => {
    const updatedLater = { ...later, title: '已更新通知' }

    expect(mergeCloudNotifications([later], [updatedLater])).toEqual([updatedLater])
  })
})
