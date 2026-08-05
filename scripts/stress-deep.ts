/**
 * 深度压力测试 — 3 项目 12 天记忆系统压力测试
 * 运行: PROMA_DEV=1 PROMA_MEMORY_EMBEDDING=local bun run scripts/stress-deep.ts
 *
 * 设计：
 * - 3 个并行项目：CodeLens（续）、ShopGo（电商后端）、DocFlow（文档工具）
 * - 12 天会话（含周末中断、并行切换、跨项目引用）
 * - 验证：
 *   1. 大量记忆（150+）下提取/去重/存储稳定
 *   2. 多项目隔离（A 项目问题不串到 B 项目）
 *   3. 召回准确（语义问句 + 精确问句混合）
 *   4. persona 演化（3 项目身份/偏好融合）
 *   5. 过期记忆（项目结束后旧任务不干扰新任务）
 */

import { extractAndCapture, confirmCorrection } from '../apps/electron/src/main/lib/memory/service'
import { readAllAtoms, readPersonaRaw, getMemoryStats, listCorrections } from '../apps/electron/src/main/lib/memory/store'
import { getMemoryLlmConfig } from '../apps/electron/src/main/lib/memory/extractor'
import { searchMemoriesHybrid } from '../apps/electron/src/main/lib/memory/recall'

const SEP = '─'.repeat(58)

/** 项目定义：每个项目 4 天，跨 12 天 */
const PROJECTS = [
  {
    name: 'CodeLens',
    session: 'deep-codelens',
    days: [
      // Day 1
      ['CodeLens 加一个批量审查模式，一次审多个 PR', '多 PR 并发要控制内存，不能 OOM', '计划用 worker_threads 做并行'],
      // Day 2（第二天）
      ['今天把 worker 池写出来了，4 核并行 OK', '发现 Windows 上路径分隔符有坑，要统一处理', '加了一个 --output=json 参数给 CI 用'],
      // Day 3（第三天，隔天）
      ['批量模式性能达标了，8 个 PR 只要 12 秒', '准备加 GitHub Action 集成，自动审 PR', '记得用 @actions/core 做日志'],
      // Day 4（第四天，隔两天）
      ['GitHub Action 集成完成了，PR 自动触发', '发现一个 bug：缓存 key 没带仓库名，会串', '修复后要补测试，覆盖缓存隔离'],
    ],
  },
  {
    name: 'ShopGo',
    session: 'deep-shopgo',
    days: [
      // Day 1（与 CodeLens Day1 并行）
      ['ShopGo 是电商后端，最近在做订单拆分', '订单拆分要支持合并付款，一个订单多个包裹', '数据库用的 PostgreSQL，有分表'],
      // Day 2
      ['今天实现了合并付款流程，事务要处理好', '用 Redis 做分布式锁，避免重复支付', '支付回调要做幂等处理，用 requestId'],
      // Day 3
      ['订单拆分测试覆盖了 90%，还行', '性能问题：大订单拆 50 个包裹时锁冲突严重', '计划用分段锁替代全局锁'],
      // Day 4
      ['分段锁上线了，并发提升 3 倍', '下次促销前要做压测，目标是 2 万 QPS', '记得用 k6 做压测脚本'],
    ],
  },
  {
    name: 'DocFlow',
    session: 'deep-docflow',
    days: [
      // Day 1（与 CodeLens Day1 并行）
      ['DocFlow 是内部文档工具，要支持多人协同编辑', '用 CRDT 做冲突合并，不用 OT', '前端用 ProseMirror 做编辑器'],
      // Day 2
      ['CRDT 集成完了，协同编辑基本可用', '权限系统：文档级 + 段落级两档', '邀请成员用邮件链接，带过期时间'],
      // Day 3
      ['协同编辑遇到性能问题，大文档卡顿', '优化方向：只同步 diff 而不是整篇', '计划加虚拟滚动，只渲染可见段落'],
      // Day 4
      ['diff 同步 + 虚拟滚动都搞定了，流畅多了', '要支持导出 PDF 和 Markdown', '导出要保留目录结构和批注'],
    ],
  },
]

/** 跨项目引用（故意制造潜在串台场景） */
const CROSS_DAYS = [
  // Day 5：三个项目交错（模拟真实多任务）
  { session: 'deep-codelens', text: '今天先处理 CodeLens 的 Action 缓存 bug，再回来看 ShopGo 的压测' },
  { session: 'deep-shopgo', text: 'ShopGo 压测脚本写好了，但发现和 CodeLens 抢内存，要错峰跑' },
  { session: 'deep-docflow', text: 'DocFlow 的导出功能要等 CodeLens 的 JSON 输出方案定型，先做别的' },
]

/** 造一批不同时长的记忆（含旧项目记忆，测试过期检测） */
const OLD_MEMORY = [
  { session: 'deep-old', text: '（上个月的项目）曾做过一个天气查询小程序，用 Python Flask，已下线' },
  { session: 'deep-old', text: '（上个月）那时候用的还是 Java，后来全切到 TypeScript 了' },
]

async function runDay(project: typeof PROJECTS[0], dayIdx: number, dayMsgs: string[]): Promise<void> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const text of dayMsgs) {
    messages.push({ role: 'user', content: text })
    messages.push({ role: 'assistant', content: '收到，记住了。' })
    const r = await extractAndCapture(messages.slice(-6), { sessionId: project.session, workspaceSlug: 'proactiveagent' })
    console.log(`  [${project.name}] ${text.slice(0, 32)}... | +${r.storedCount} (${r.mode})`)
  }
}

async function recallTest(q: string): Promise<{ hits: string[]; strategy: string }> {
  const r = await searchMemoriesHybrid({ query: q, limit: 5 })
  return { hits: r.hits.map((h) => h.atom.content), strategy: r.strategy }
}

async function answerWithMemory(q: string): Promise<string> {
  const cfg = getMemoryLlmConfig()
  if (!cfg) return ''
  const block = (await recallTest(q)).hits.map((c) => `- ${c}`).join('\n')
  const resp = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: `你是 Proma Agent，只能靠记忆回答。\n<memory_context>\n${block || '（无）'}\n</memory_context>` }, { role: 'user', content: q }],
      max_tokens: 400,
      temperature: 0.4,
    }),
  })
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

console.log('')
console.log('══════════════════════════════════════════════════════')
console.log('  深度压力测试 · 3 项目 12 天')
console.log('══════════════════════════════════════════════════════')
console.log('')

// ===== Phase 1：3 项目各 4 天 =====
console.log(SEP)
console.log('【Phase 1】3 项目并行开发（各 4 天）')
console.log(SEP)
console.log('')
for (let day = 0; day < 4; day++) {
  console.log(`--- Day ${day + 1} ---`)
  for (const project of PROJECTS) {
    await runDay(project, day, project.days[day]!)
  }
}

// ===== Phase 2：跨项目交错（Day 5） =====
console.log(SEP)
console.log('【Phase 2】跨项目交错（Day 5，潜在串台场景）')
console.log(SEP)
console.log('')
for (const c of CROSS_DAYS) {
  const r = await extractAndCapture(
    [{ role: 'user', content: c.text }, { role: 'assistant', content: '好的' }],
    { sessionId: c.session, workspaceSlug: 'proactiveagent' },
  )
  console.log(`  [${c.session}] ${c.text.slice(0, 40)}... | +${r.storedCount}`)
}

// ===== Phase 3：旧项目记忆（过期检测） =====
console.log(SEP)
console.log('【Phase 3】旧项目记忆（过期检测）')
console.log(SEP)
console.log('')
for (const old of OLD_MEMORY) {
  const r = await extractAndCapture(
    [{ role: 'user', content: old.text }, { role: 'assistant', content: '好的' }],
    { sessionId: old.session, workspaceSlug: 'proactiveagent' },
  )
  console.log(`  [old] ${old.text.slice(0, 32)}... | +${r.storedCount}`)
}

// 确认一条纠正（反馈回流）
const pending = listCorrections('pending')
console.log(`\n待确认纠正: ${pending.length} 条，模拟确认 1 条...`)
if (pending.length > 0) {
  confirmCorrection(pending[0]!.id)
  console.log(`  ✓ 已确认: ${pending[0]!.rule.slice(0, 40)}`)
}
await new Promise((r) => setTimeout(r, 4000))

// ===== Phase 4：汇总 =====
console.log(SEP)
console.log('【记忆状态汇总】')
console.log(SEP)
console.log('')
const stats = getMemoryStats()
const atoms = readAllAtoms({ includeUnconfirmed: true })
console.log(`记忆总数: ${stats.atomCount} | fact:${stats.byType.fact} pref:${stats.byType.preference} corr:${stats.byType.correction} sop:${stats.byType.sop} todo:${stats.byType.todo_context}`)
console.log(`persona: ${stats.personaExists ? '✓' : '✗'}`)
console.log('')

// ===== Phase 5：召回矩阵 =====
console.log(SEP)
console.log('【召回矩阵】12 问（含语义问句 + 精确问句 + 串台检测）')
console.log(SEP)
console.log('')
const questions = [
  // 项目精确问句
  { q: 'CodeLens 批量审查用什么做并行？', expect: 'worker' },
  { q: 'ShopGo 订单拆分用什么锁？', expect: '分段锁' },
  { q: 'DocFlow 协同编辑用什么冲突合并？', expect: 'CRDT' },
  // 语义问句
  { q: 'ShopGo 怎么避免重复支付？', expect: '幂等' },
  { q: 'CodeLens 怎么解决缓存串仓库的问题？', expect: '缓存 key' },
  // 跨项目引用问句
  { q: '最近 CodeLens 和 ShopGo 有什么冲突？', expect: '内存' },
  // 串台检测：问 A 项目，不应答 B 项目
  { q: 'DocFlow 用什么编辑器？', expect: 'ProseMirror', notExpect: ['worker', '分段锁', 'k6'] },
  { q: 'ShopGo 用什么做压测？', expect: 'k6', notExpect: ['CRDT', 'ProseMirror'] },
  // 过期记忆检测
  { q: '那个天气小程序还在维护吗？', expect: '下线', hint: '过期' },
  // 身份/偏好
  { q: '我最早用什么语言？后来切到什么？', expect: 'Java', hint: '演化' },
  { q: '我有什么工作习惯？', expect: 'lint' },
  // 性能数据
  { q: 'ShopGo 压测目标是多少 QPS？', expect: '2万' },
]

let passCount = 0
for (const { q, expect: expectStr, notExpect, hint } of questions) {
  const { hits } = await recallTest(q)
  const joined = hits.join(' ')
  const hasExpect = joined.includes(expectStr)
  const hasNotExpect = notExpect ? notExpect.some((n) => joined.includes(n)) : false
  const ok = hasExpect && !hasNotExpect
  if (ok) passCount += 1
  console.log(`${ok ? '✅' : '❌'} Q: ${q}${hint ? ` (${hint})` : ''}`)
  console.log(`   expect=${expectStr} | 命中: ${hits[0]?.slice(0, 60) ?? '（无）'}${notExpect ? ` | 不应含: ${notExpect.join('/')}${hasNotExpect ? ' ⚠️串台!' : ''}` : ''}`)
}
console.log(`\n召回矩阵: ${passCount}/${questions.length} 通过`)
console.log('')

// ===== Phase 6：真实回答 =====
console.log(SEP)
console.log('【真实回答】（3 个代表性问句，DeepSeek 基于记忆）')
console.log(SEP)
console.log('')
for (const q of ['ShopGo 怎么避免重复支付？', 'CodeLens 和 ShopGo 最近有什么交集？', '你记得我有什么工作习惯？']) {
  const ans = await answerWithMemory(q)
  console.log(`Q: ${q}`)
  console.log(`A: ${ans.replace(/\n/g, ' ').slice(0, 160)}`)
  console.log('')
}

console.log(SEP)
console.log('深度压力测试完成。')
console.log(SEP)
process.exit(0)
