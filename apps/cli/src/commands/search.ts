/**
 * proma session search — 在会话内子串搜索，返回命中 turn 的下标与片段。
 * Agent 据此再用 export --turns 取命中邻域，避免全量读。
 */
import { register } from '../registry'
import { resolveSession } from '../sessions'
import { emitJson, emitText, errorLine, info, EXIT_OK, EXIT_ERROR, UsageError } from '../output'
import { readSessionMessages } from '@proma/session-core/node'
import { groupIntoTurns, toTranscript, searchTurns } from '@proma/session-core'
import { numFlag, boolFlag } from '../args'

register({
  name: 'search',
  summary: '在会话内搜索关键词，返回命中 turn 下标 + 片段',
  usage: 'session search <query> <id|path> [--context N] [--limit N] [--case-sensitive] [--json]',
  run: (ctx) => {
    const [query, target] = ctx.args.positionals
    if (!query) throw new UsageError('缺少搜索词')
    if (!target) throw new UsageError('缺少会话 id 或路径')
    const resolved = resolveSession(target, ctx.pathOpts)
    if (!resolved) {
      errorLine(`找不到会话: ${target}`)
      return EXIT_ERROR
    }

    const turns = toTranscript(groupIntoTurns(readSessionMessages(resolved.filePath)))
    const hits = searchTurns(turns, query, {
      context: numFlag(ctx.args.flags, 'context'),
      limit: numFlag(ctx.args.flags, 'limit'),
      caseSensitive: boolFlag(ctx.args.flags, 'case-sensitive'),
    })

    if (ctx.json) {
      emitJson(hits)
      return EXIT_OK
    }
    if (hits.length === 0) {
      info(`未命中: "${query}"`)
      return EXIT_OK
    }
    for (const h of hits) {
      emitText(`#${h.index} [${h.role}] (${h.matchCount}处) ${h.snippet}`)
    }
    return EXIT_OK
  },
})
