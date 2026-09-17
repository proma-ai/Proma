import { afterEach, describe, expect, test } from 'bun:test'
import { listChangelogs } from './changelog-service'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('公开更新日志服务', () => {
  test('Given a limit When listing changelogs Then requests the website public API and returns its payload', async () => {
    const payload = {
      changelogs: [
        {
          id: 'log_1',
          version: '0.19.61',
          title: '商业版更新',
          content: '更新内容',
          publishedAt: '2026-09-17T12:00:00Z',
          commentCount: 0,
        },
      ],
      nextCursor: null,
    }
    const requestedUrls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      requestedUrls.push(String(input))
      return new Response(JSON.stringify(payload), { status: 200 })
    }) as typeof fetch

    await expect(listChangelogs({ limit: 3 })).resolves.toEqual(payload)
    expect(requestedUrls).toEqual([
      'https://api.proma.cool/api/v1/changelogs?limit=3',
    ])
  })

  test('Given a failed public API response When listing changelogs Then returns an actionable error', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch

    await expect(listChangelogs()).rejects.toThrow('暂时无法加载更新日志，请稍后重试。')
  })

  test('Given a pagination cursor When listing changelogs Then URL-encodes the cursor query', async () => {
    let requestedUrl = ''
    globalThis.fetch = (async (input: string | URL | Request) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify({ changelogs: [], nextCursor: null }), { status: 200 })
    }) as typeof fetch

    await listChangelogs({ limit: 3, cursor: 'log/with space' })

    expect(requestedUrl).toBe(
      'https://api.proma.cool/api/v1/changelogs?limit=3&cursor=log%2Fwith+space',
    )
  })
})
