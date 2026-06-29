/**
 * proma session list — 列出会话索引（便宜，不读 JSONL 正文）。
 */
import { register } from '../registry'
import { listSessions } from '../sessions'
import { emitJson, emitText, info, EXIT_OK } from '../output'
import { numFlag, strFlag } from '../args'

interface MetaLike {
  id: string
  title?: string
  updatedAt?: number
  workspaceId?: string
  modelId?: string
  archived?: boolean
}

register({
  name: 'list',
  summary: '列出会话（id / 标题 / 更新时间 / 工作区），按更新时间降序',
  usage: 'session list [--limit N] [--workspace W] [--json]',
  run: (ctx) => {
    const limit = numFlag(ctx.args.flags, 'limit')
    const workspace = strFlag(ctx.args.flags, 'workspace')
    let sessions = listSessions(ctx.pathOpts) as MetaLike[]
    if (workspace) sessions = sessions.filter((s) => s.workspaceId === workspace)
    if (limit && limit > 0) sessions = sessions.slice(0, limit)

    if (ctx.json) {
      emitJson(sessions.map((s) => ({
        id: s.id,
        title: s.title ?? '',
        updatedAt: s.updatedAt,
        workspaceId: s.workspaceId,
        modelId: s.modelId,
        archived: !!s.archived,
      })))
      return EXIT_OK
    }

    if (sessions.length === 0) {
      info('（没有会话）')
      return EXIT_OK
    }
    for (const s of sessions) {
      const when = s.updatedAt ? new Date(s.updatedAt).toISOString().slice(0, 16).replace('T', ' ') : '—'
      const title = (s.title ?? '').replace(/\s+/g, ' ').slice(0, 50) || '(无标题)'
      emitText(`${s.id}  ${when}  ${title}`)
    }
    return EXIT_OK
  },
})
