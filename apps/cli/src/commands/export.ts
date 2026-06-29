/**
 * proma session export — 把会话(或其 turn 子集)渲染为干净 Markdown。
 *
 * 面向有限上下文的护栏：当**未指定任何窗口**且输出超过 --max-bytes（默认 51200 = 50KB）时，
 * 拒绝直接灌 stdout，改为落盘并回执路径，提示用 --turns/--head/--tail 取片段。
 * 这样 Agent 不会因为一句 `export <id>` 就把一个 50MB 会话的清洗结果塞满上下文。
 *
 * 窗口优先级（见 selectTurns）：--turns > --head > --tail > --offset/--limit。
 * --out FILE 显式落盘（存档用途，不受 max-bytes 护栏限制）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { register } from '../registry'
import { resolveSession } from '../sessions'
import { emitJson, emitText, errorLine, info, EXIT_OK, EXIT_ERROR, UsageError } from '../output'
import { readSessionMessages } from '@proma/session-core/node'
import { groupIntoTurns, toTranscript, selectTurns, renderTranscriptMarkdown } from '@proma/session-core'
import { numFlag, strFlag, boolFlag, parseRange } from '../args'

const DEFAULT_MAX_BYTES = 51200 // 50KB

register({
  name: 'export',
  summary: '把会话或 turn 子集渲染为干净 Markdown（含超预算落盘护栏）',
  usage: 'session export <id|path> [--turns A-B | --head N | --tail N | --offset K --limit N] [--out FILE] [--stdout] [--max-bytes N] [--json]',
  run: (ctx) => {
    const target = ctx.args.positionals[0]
    if (!target) throw new UsageError('缺少会话 id 或路径')
    const resolved = resolveSession(target, ctx.pathOpts)
    if (!resolved) {
      errorLine(`找不到会话: ${target}`)
      return EXIT_ERROR
    }

    const allTurns = toTranscript(groupIntoTurns(readSessionMessages(resolved.filePath)))

    // 解析窗口
    const range = parseRange(strFlag(ctx.args.flags, 'turns'))
    const head = numFlag(ctx.args.flags, 'head')
    const tail = numFlag(ctx.args.flags, 'tail')
    const offset = numFlag(ctx.args.flags, 'offset')
    const limit = numFlag(ctx.args.flags, 'limit')
    const hasWindow = range !== undefined || head !== undefined || tail !== undefined || offset !== undefined || limit !== undefined

    const turns = hasWindow ? selectTurns(allTurns, { range, head, tail, offset, limit }) : allTurns
    // 截取片段时省略顶部标题，便于直接拼接阅读
    const md = renderTranscriptMarkdown(turns, { sessionId: resolved.id, header: !hasWindow })
    const bytes = Buffer.byteLength(md, 'utf-8')

    const outPath = strFlag(ctx.args.flags, 'out')
    const forceStdout = boolFlag(ctx.args.flags, 'stdout')
    const maxBytes = numFlag(ctx.args.flags, 'max-bytes') ?? DEFAULT_MAX_BYTES

    // 显式落盘
    if (outPath) {
      writeFileTo(outPath, md)
      const result = { written: outPath, bytes, turns: turns.length, totalTurns: allTurns.length }
      if (ctx.json) emitJson(result)
      else info(`已写入 ${outPath}（${turns.length} turns, ${(bytes / 1024).toFixed(1)} KB）`)
      return EXIT_OK
    }

    // 护栏：未指定窗口 + 超预算 + 未强制 stdout → 落盘回执，不灌 stdout
    if (!hasWindow && !forceStdout && bytes > maxBytes) {
      const fallback = `${resolved.id}.clean.md`
      writeFileTo(fallback, md)
      const result = {
        guarded: true,
        reason: 'output-exceeds-max-bytes',
        bytes,
        maxBytes,
        turns: allTurns.length,
        written: fallback,
        hint: '输出过大已落盘。用 --turns A-B / --head N / --tail N 取片段，或 --stdout 强制全量，或 --out 指定路径。先跑 `proma session outline <id>` 看结构。',
      }
      if (ctx.json) {
        emitJson(result)
      } else {
        info(`⚠️ 输出 ${(bytes / 1024).toFixed(0)}KB 超过预算 ${(maxBytes / 1024).toFixed(0)}KB，已落盘到 ${fallback}`)
        info(result.hint)
      }
      return EXIT_OK
    }

    // 正常输出到 stdout
    emitText(md)
    return EXIT_OK
  },
})

function writeFileTo(path: string, content: string): void {
  const dir = dirname(path)
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
  writeFileSync(path, content, 'utf-8')
}
