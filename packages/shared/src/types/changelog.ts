/**
 * 公开更新日志相关类型与 IPC 通道
 */

/** 公共更新日志条目 */
export interface ChangelogItem {
  id: string
  version: string | null
  title: string
  content: string
  publishedAt: string | null
  commentCount: number
}

/** 公共更新日志分页响应 */
export interface ChangelogListResponse {
  changelogs: ChangelogItem[]
  nextCursor: string | null
}

/** 更新日志列表查询参数 */
export interface ChangelogListOptions {
  limit?: number
  cursor?: string
}

/** 更新日志 IPC 通道 */
export const CHANGELOG_IPC_CHANNELS = {
  LIST: 'changelog:list',
} as const
