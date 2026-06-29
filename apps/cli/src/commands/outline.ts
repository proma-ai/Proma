/**
 * proma session outline — turn 级地图。每 turn 一行的结构概览，
 * 让 Agent 先看地图再决定读哪段，避免全量读正文。
 */
import { register } from '../registry'
import { resolveSession } from '../sessions'
import { emitJson, emitText, errorLine, EXIT_OK, EXIT_ERROR, UsageError } from '../output'
import { readSessionMessages } from '@proma/session-core/node'
import { groupIntoTurns, toTranscript, outline, formatOutlineLine, selectTurns } from '@proma/session-core'
import { numFlag } from '../args'

register({
  name: 'outline',
  summary: 'turn 级地图：每 turn 一行（角色 / 预览 / 工具概览 / 估算 tokens）',
  usage: 'session outline <id|path> [--offset K] [--limit N] [--json]',
  run: (ctx) => {
    const target = ctx.args.positionals[0]
    if (!target) throw new UsageError('缺少会话 id 或路径')
    const resolved = resolveSession(target, ctx.pathOpts)
    if (!resolved) {
      errorLine(`找不到会话: ${target}`)
      return EXIT_ERROR
    }

    let turns = toTranscript(groupIntoTurns(readSessionMessages(resolved.filePath)))
    const offset = numFlag(ctx.args.flags, 'offset')
    const limit = numFlag(ctx.args.flags, 'limit')
    if (offset !== undefined || limit !== undefined) {
      turns = selectTurns(turns, { offset, limit })
    }
    const entries = outline(turns)

    if (ctx.json) {
      emitJson(entries)
      return EXIT_OK
    }
    for (const e of entries) emitText(formatOutlineLine(e))
    return EXIT_OK
  },
})
