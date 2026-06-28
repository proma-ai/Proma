/**
 * proma session info — 会话体量与结构概览（决定怎么读之前先看大小）。
 *
 * 读 JSONL 解析为 turns，但只输出统计量（turn 数 / 角色分布 / 估算 tokens / 字节数 / 时间区间），
 * 不输出正文——让 Agent 据此判断该全量读还是分段/搜索读。
 */
import { register } from '../registry'
import { resolveSession } from '../sessions'
import { emitJson, emitText, errorLine, info, EXIT_OK, EXIT_ERROR, UsageError } from '../output'
import { readSessionMessages } from '@proma/session-core/node'
import { groupIntoTurns, toTranscript } from '@proma/session-core'

register({
  name: 'info',
  summary: '会话体量/结构概览：turn 数、角色分布、估算 tokens、字节数',
  usage: 'session info <id|path> [--json]',
  run: (ctx) => {
    const target = ctx.args.positionals[0]
    if (!target) throw new UsageError('缺少会话 id 或路径')
    const resolved = resolveSession(target, ctx.pathOpts)
    if (!resolved) {
      errorLine(`找不到会话: ${target}`)
      return EXIT_ERROR
    }

    const turns = toTranscript(groupIntoTurns(readSessionMessages(resolved.filePath)))
    const byRole = turns.reduce<Record<string, number>>((m, t) => {
      m[t.role] = (m[t.role] ?? 0) + 1
      return m
    }, {})
    const totalTokens = turns.reduce((s, t) => s + t.tokens, 0)

    const report = {
      id: resolved.id,
      title: resolved.meta?.title,
      bytes: resolved.bytes,
      turns: turns.length,
      roles: byRole,
      estimatedTokens: totalTokens,
      model: (resolved.meta as { modelId?: string } | undefined)?.modelId,
    }

    if (ctx.json) {
      emitJson(report)
      return EXIT_OK
    }

    info(`会话 ${report.id}${report.title ? `  «${report.title}»` : ''}`)
    emitText(`turns: ${report.turns}  (${Object.entries(byRole).map(([r, n]) => `${r}:${n}`).join(' ')})`)
    emitText(`估算 tokens: ~${totalTokens}`)
    if (report.bytes != null) emitText(`原始 JSONL: ${(report.bytes / 1024).toFixed(0)} KB`)
    return EXIT_OK
  },
})
