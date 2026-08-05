/**
 * Proactive Memory 召回评测脚本（bench-recall）
 *
 * 用途：对当前记忆库跑一组标准问句，客观评估关键词召回的 Recall / Precision / False-Alarm。
 * 口径说明：这是 Proma 本地问句集（借鉴 stress 测试与 ProactiveAgent 误报控制思想），
 * **不是** OmniMemEval / LoCoMo / LongMemEval 等第三方 harness，分数不与其直接可比。
 *
 * 运行：
 *   # 默认读取 ~/.proma/memory（正式库）
 *   bun run scripts/bench-recall.ts
 *   # 指定 dev 库 / embedding 模式
 *   PROMA_DEV=1 bun run scripts/bench-recall.ts
 *   PROMA_MEMORY_EMBEDDING=local bun run scripts/bench-recall.ts
 *
 * 判定规则（自动，不需要人工）：
 *   - 命中（relevant）：召回结果中至少一条 atom 命中 expectedKeywords 中的任一关键词
 *   - 正确沉默（true negative）：问句标记 expectSilent=true 且召回 0 条 → 计为成功
 *   - False-Alarm：expectSilent=true 的问句召回 > 0 条 → 打扰（FA）
 *   - Missed：expectSilent=false 的问句召回 0 条 → 漏召回
 */

import { searchMemoriesByKeyword, tokenize } from '../apps/electron/src/main/lib/memory/recall'
import { getMemoryStats } from '../apps/electron/src/main/lib/memory/store'

/** 标准问句集：{ query, expectedKeywords, expectSilent } */
interface BenchQuestion {
  query: string
  /** 命中即认为召回正确的关键词（任一命中即可） */
  expectedKeywords: string[]
  /** 期望沉默（不该召回任何内容） */
  expectSilent?: boolean
}

const QUESTIONS: BenchQuestion[] = [
  // —— 多项目召回（来自 stress 测试 12 问，验证跨会话/近义词） ——
  { query: 'CodeLens 用什么做并行？', expectedKeywords: ['worker', '并行', 'codelens'] },
  { query: 'ShopGo 订单拆分用什么锁？', expectedKeywords: ['分段锁', '锁', 'shopgo'] },
  { query: 'DocFlow 用什么冲突合并？', expectedKeywords: ['crdt', '合并', 'docflow'] },
  { query: 'ShopGo 怎么避免重复支付？', expectedKeywords: ['幂等', '重复支付', 'shopgo'] },
  { query: 'DocFlow 用什么编辑器？', expectedKeywords: ['prosemirror', '编辑器', 'docflow'] },
  { query: 'ShopGo 用什么做压测？', expectedKeywords: ['k6', '压测', 'shopgo'] },
  { query: '天气小程序还在维护吗？', expectedKeywords: ['下线', '天气'] },
  { query: '最早用什么语言？', expectedKeywords: ['java', 'typescript', '语言', '切换'] },
  { query: 'ShopGo 压测目标 QPS？', expectedKeywords: ['2万', '20000', 'qps', '压测'] },
  { query: '订单拆分支持合并付款？', expectedKeywords: ['合并付款', '订单'] },
  { query: '写代码用什么语言？', expectedKeywords: ['typescript', 'java', '语言', '技术栈'] },
  { query: '你还记得我是谁吗？', expectedKeywords: ['conrad', '名字'] },
  // —— 误报控制样例（期望沉默） ——
  { query: '帮我写一个排序算法', expectSilent: true },
  { query: '今天天气怎么样', expectSilent: true },
  { query: '讲个笑话', expectSilent: true },
]

interface Row {
  query: string
  hits: number
  ok: boolean
  silentExpected: boolean
  detail: string
}

function run(): void {
  console.log('')
  console.log('══════════════════════════════════════════════════════')
  console.log('  Proactive Memory · 召回评测（bench-recall）')
  console.log('══════════════════════════════════════════════════════')
  console.log('')

  const stats = getMemoryStats()
  console.log(`记忆库: ${stats.atomCount} 条（fact ${stats.byType.fact} / preference ${stats.byType.preference} / correction ${stats.byType.correction} / sop ${stats.byType.sop} / todo ${stats.byType.todo_context} / event ${stats.byType.event}）`)
  console.log('')

  const rows: Row[] = []
  for (const q of QUESTIONS) {
    const result = searchMemoriesByKeyword({ query: q.query, limit: 5 })
    const hits = result.hits.length
    let ok: boolean
    if (q.expectSilent) {
      // 期望沉默：0 条 = 正确；>0 条 = False-Alarm
      ok = hits === 0
    } else {
      // 期望命中：任一 expectedKeywords 出现在召回内容中即视为相关
      const content = result.hits.map((h) => h.atom.content).join(' ').toLowerCase()
      const relevant = hits > 0 && (q.expectedKeywords ?? []).some((kw) => content.includes(kw.toLowerCase()))
      ok = relevant
    }
    rows.push({
      query: q.query,
      hits,
      ok,
      silentExpected: !!q.expectSilent,
      detail: hits > 0 ? result.hits.map((h) => `[${h.atom.type}] ${h.atom.content.slice(0, 60)}`).join(' | ') : '（0 条）',
    })
  }

  // 指标统计
  const total = rows.length
  const silentQs = rows.filter((r) => r.silentExpected)
  const normalQs = rows.filter((r) => !r.silentExpected)

  const normalHit = normalQs.filter((r) => r.ok && r.hits > 0).length
  const normalMiss = normalQs.filter((r) => !r.ok).length // 期望命中但 0 条 / 没命中
  const silentOk = silentQs.filter((r) => r.ok).length
  const silentFa = silentQs.filter((r) => !r.ok).length

  const recall = normalQs.length > 0 ? normalHit / normalQs.length : 0
  const faRate = silentQs.length > 0 ? silentFa / silentQs.length : 0
  const overall = rows.filter((r) => r.ok).length / total

  // 输出明细
  console.log('── 明细 ──')
  for (const r of rows) {
    const mark = r.ok ? '✅' : '❌'
    console.log(`${mark} ${r.query}  → ${r.hits} 条${r.hits > 0 ? ` · ${r.detail}` : ''}`)
  }

  console.log('')
  console.log('── 指标 ──')
  console.log(`总体正确率: ${(overall * 100).toFixed(1)}%  (${rows.filter((r) => r.ok).length}/${total})`)
  console.log(`召回（期望命中的问句中正确命中）: ${(recall * 100).toFixed(1)}%  (${normalHit}/${normalQs.length})`)
  console.log(`误报率（期望沉默的问句中误召回）: ${(faRate * 100).toFixed(1)}%  (${silentFa}/${silentQs.length})`)
  console.log('')
  console.log('⚠️  口径说明：本脚本为 Proma 本地问句集，非 OmniMemEval/LoCoMo/LongMemEval harness，分数不与其直接可比。')
  console.log('    误报控制参考 ProactiveAgent（ICLR 2025）：该沉默时沉默也是能力。')
  console.log('')
}

run()
