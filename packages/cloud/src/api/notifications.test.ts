import { describe, expect, test } from 'bun:test'
import { createNotificationsApi, normalizePendingNotifications } from './notifications'
import type { NotificationsApiClient } from './notifications'

const sampleNotification = {
  id: 'notification-1',
  title: '服务公告',
  bodyMarkdown: '请查看更新内容。',
  platform: 'desktop',
  publishedAt: '2026-09-17T08:00:00Z',
}

function createClient(payload: unknown): { client: NotificationsApiClient; getPaths: string[]; postPaths: string[] } {
  const getPaths: string[] = []
  const postPaths: string[] = []

  const client: NotificationsApiClient = {
    get: async <T>(path: string) => {
      getPaths.push(path)
      return { data: payload as T, status: 200, ok: true }
    },
    post: async <T>(path: string) => {
      postPaths.push(path)
      return { data: undefined as T, status: 200, ok: true }
    },
  }

  return { client, getPaths, postPaths }
}

describe('Cloud notifications API', () => {
  test('Given a pending notification array When normalizing Then only complete notifications are retained', () => {
    const notifications = normalizePendingNotifications([
      sampleNotification,
      { id: 'incomplete', title: '缺少字段' },
    ])

    expect(notifications).toEqual([sampleNotification])
  })

  test('Given the wrapped pending response used by early servers When fetching Then returns its notifications', async () => {
    const { client, getPaths } = createClient({ notifications: [sampleNotification] })

    await expect(createNotificationsApi(client).listPending('macos')).resolves.toEqual([sampleNotification])
    expect(getPaths).toEqual(['/notifications/pending?platform=macos'])
  })

  test('Given a notification identifier with reserved URL characters When acknowledging Then encodes the ID and includes its platform', async () => {
    const { client, postPaths } = createClient([])

    await createNotificationsApi(client).acknowledge('announcement/2026?draft', 'macos')

    expect(postPaths).toEqual(['/notifications/announcement%2F2026%3Fdraft/acknowledge?platform=macos'])
  })
})
