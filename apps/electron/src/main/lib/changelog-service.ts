/**
 * 公开更新日志服务
 *
 * 与 proma-website-v2 使用相同的公共更新日志接口。
 */

import type { ChangelogListOptions, ChangelogListResponse } from '@proma/shared'

const PUBLIC_API_BASE_URL = 'https://api.proma.cool/api/v1'
const DEFAULT_LIMIT = 10

/** 获取已发布的更新日志。 */
export async function listChangelogs(
  options: ChangelogListOptions = {},
): Promise<ChangelogListResponse> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? DEFAULT_LIMIT),
  })
  if (options.cursor) params.set('cursor', options.cursor)

  const response = await fetch(`${PUBLIC_API_BASE_URL}/changelogs?${params.toString()}`)
  if (!response.ok) {
    throw new Error('暂时无法加载更新日志，请稍后重试。')
  }

  return response.json() as Promise<ChangelogListResponse>
}
