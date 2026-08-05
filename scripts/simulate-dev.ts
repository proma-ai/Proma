/**
 * 模拟项目开发 — 记忆系统压力测试
 * 运行: PROMA_DEV=1 PROMA_MEMORY_EMBEDDING=local bun run scripts/simulate-dev.ts
 *
 * 模拟一个虚构项目「Proma CodeLens 代码审查助手」6 个跨天开发会话，
 * 每轮真实 LLM 提取记忆，验证：
 * 1. 多会话记忆自动沉淀（fact/preference/correction/sop/todo_context）
 * 2. persona 随会话演化（新增偏好/协议/轨迹）
 * 3. 跨会话召回（新会话问"项目用什么技术"等）
 * 4. 反馈回流（确认纠正 → persona 更新）
 */

import { extractAndCapture, contextForMessage, confirmCorrection } from '../apps/electron/src/main/lib/memory/service'
import { readAllAtoms, readPersonaRaw, getMemoryStats, listCorrections } from '../apps/electron/src/main/lib/memory/store'
import { getMemoryLlmConfig } from '../apps/electron/src/main/lib/memory/extractor'
import { searchMemoriesHybrid } from '../apps/electron/src/main/lib/memory/recall'

const SEP = '─'.repeat(58)

async function recallBlock(q: string): Promise<string> {
  const r = await searchMemoriesHybrid({ query: q, limit: 5 })
  if (r.hits.length === 0) return ''
  return r.hits.map((h) => '- [' + h.atom.type + '|' + h.score.toFixed(2) + '] ' + h.atom.content).join('\n')
}

async function answerWithMemory(q: string): Promise<string> {
  const block = await recallBlock(q)
  const cfg = getMemoryLlmConfig()
  if (!cfg) return '（未配置 LLM）'
  const systemPrompt = `你是 Proma Agent。新会话无历史，只能靠记忆回答。\n\n<memory_context>\n${block || '（无召回）'}\n</memory_context>`
  const resp = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: q }],
      max_tokens: 400,
      temperature: 0.4,
    }),
  })
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trim() ?? '（空）'
}

console.log('')
console.log('══════════════════════════════════════════════════════')
console.log('  模拟项目开发 · 记忆系统压力测试')
console.log('  项目：Proma CodeLens（代码审查助手）')
console.log('══════════════════════════════════════════════════════')
console.log('')

// ===== 会话 1：项目启动 =====
console.log(SEP)
console.log('【Day 1 · 项目启动】')
console.log(SEP)
console.log('')
const s1: Array<{ role: 'user' | 'assistant'; content: string }> = []
const day1 = [
  '我想给 Proma 做一个代码审查助手插件，叫 CodeLens，能自动分析 PR 里的问题',
  '这个插件要支持多语言，优先 TypeScript 和 Rust 项目，因为我自己用这两个',
  '希望是本地运行，不上传代码到云端，隐私很重要',
]
for (const t of day1) {
  s1.push({ role: 'user', content: t })
  s1.push({ role: 'assistant', content: '好的，记下了。' })
  const r = await extractAndCapture(s1.slice(-6), { sessionId: 'sim-day1', workspaceSlug: 'proactiveagent' })
  console.log(`  你 > ${t.slice(0, 40)}... | 提取 +${r.storedCount} (${r.mode})`)
}
console.log('')

// ===== 会话 2：技术选型 =====
console.log(SEP)
console.log('【Day 2 · 技术选型】')
console.log(SEP)
console.log('')
const s2: Array<{ role: 'user' | 'assistant'; content: string }> = []
const day2 = [
  '审查逻辑打算用 AST 分析，不依赖正则，这样更准确',
  '技术栈用 TypeScript + node，直接用 Proma 的插件系统，不用单独起服务',
  '我偏好用 Bun 而不是 npm，因为快且一体化',
]
for (const t of day2) {
  s2.push({ role: 'user', content: t })
  s2.push({ role: 'assistant', content: '好的。' })
  const r = await extractAndCapture(s2.slice(-6), { sessionId: 'sim-day2', workspaceSlug: 'proactiveagent' })
  console.log(`  你 > ${t.slice(0, 40)}... | 提取 +${r.storedCount} (${r.mode})`)
}
console.log('')

// ===== 会话 3：实现核心 =====
console.log(SEP)
console.log('【Day 3 · 实现核心逻辑】')
console.log(SEP)
console.log('')
const s3: Array<{ role: 'user' | 'assistant'; content: string }> = []
const day3 = [
  '今天把 AST 分析器写出来了，能识别未使用变量和潜在类型错误',
  '发现一个问题：大 PR 分析很慢，需要加缓存和并发控制',
  '性能要求是 5000 行以内的 PR 在 3 秒内完成分析',
]
for (const t of day3) {
  s3.push({ role: 'user', content: t })
  s3.push({ role: 'assistant', content: '明白。' })
  const r = await extractAndCapture(s3.slice(-6), { sessionId: 'sim-day3', workspaceSlug: 'proactiveagent' })
  console.log(`  你 > ${t.slice(0, 40)}... | 提取 +${r.storedCount} (${r.mode})`)
}
console.log('')

// ===== 会话 4：用户纠正 =====
console.log(SEP)
console.log('【Day 4 · 用户纠正 + 反馈回流】')
console.log(SEP)
console.log('')
const s4: Array<{ role: 'user' | 'assistant'; content: string }> = []
const day4 = [
  '以后不要用正则做代码分析，一律用 AST，这样才准',
  '还有，这个插件的配置应该放在 .codelens.json 而不是环境变量，方便版本管理',
]
for (const t of day4) {
  s4.push({ role: 'user', content: t })
  s4.push({ role: 'assistant', content: '收到，记住了。' })
  const r = await extractAndCapture(s4.slice(-6), { sessionId: 'sim-day4', workspaceSlug: 'proactiveagent' })
  console.log(`  你 > ${t.slice(0, 40)}... | 提取 +${r.storedCount}, 纠正 ${r.corrections} (${r.mode})`)
}
console.log('')
// 确认纠正（模拟用户确认回流）
const pending = listCorrections('pending')
console.log(`  待确认纠正: ${pending.length} 条，模拟用户确认...`)
for (const c of pending.slice(0, 2)) {
  confirmCorrection(c.id)
  console.log(`    ✓ 已确认: ${c.rule.slice(0, 40)}`)
}
await new Promise((r) => setTimeout(r, 4000))
console.log('')

// ===== 会话 5：优化与收尾 =====
console.log(SEP)
console.log('【Day 5 · 优化与发布准备】')
console.log(SEP)
console.log('')
const s5: Array<{ role: 'user' | 'assistant'; content: string }> = []
const day5 = [
  '加了缓存后性能达标了，5000 行 2.5 秒搞定',
  '准备下周发 v0.1，先写文档和测试，测试覆盖率要 90% 以上',
  '以后每次提交代码前记得先跑一遍 lint 和测试，不要直接提交',
]
for (const t of day5) {
  s5.push({ role: 'user', content: t })
  s5.push({ role: 'assistant', content: '好。' })
  const r = await extractAndCapture(s5.slice(-6), { sessionId: 'sim-day5', workspaceSlug: 'proactiveagent' })
  console.log(`  你 > ${t.slice(0, 40)}... | 提取 +${r.storedCount} (${r.mode})`)
}
console.log('')

// ===== 汇总 =====
console.log(SEP)
console.log('【记忆系统状态汇总】')
console.log(SEP)
console.log('')
const stats = getMemoryStats()
const atoms = readAllAtoms({ includeUnconfirmed: true })
console.log(`记忆总数: ${stats.atomCount} | 类型: ${JSON.stringify(stats.byType)}`)
console.log(`persona: ${stats.personaExists ? '✓' : '✗'}`)
console.log('')
console.log('L1 原子记忆（最新 15 条）:')
for (const a of atoms.slice(0, 15)) {
  console.log(`  [${a.type}|pri=${a.priority}] ${a.content.slice(0, 55)}`)
}
console.log('')
console.log('L3 用户画像 (profile.md):')
console.log(readPersonaRaw()?.slice(0, 700) ?? '（无）')
console.log('')

// ===== 跨会话召回验证 =====
console.log(SEP)
console.log('【跨会话召回验证】（全新会话提问）')
console.log(SEP)
console.log('')
const questions = [
  '我在做的 CodeLens 是什么？',
  '这个项目用什么技术栈和工具？',
  '代码分析用什么方法？',
  '我有什么工作习惯？',
]
for (const q of questions) {
  console.log(`Q: ${q}`)
  const block = await recallBlock(q)
  console.log(`  召回: ${block ? block.slice(0, 150).replace(/\n/g, ' ') + '...' : '（无）'}`)
  const ans = await answerWithMemory(q)
  console.log(`  A: ${ans.replace(/\n/g, ' ').slice(0, 120)}`)
  console.log('')
}

console.log(SEP)
console.log('模拟开发完成。报告已生成。')
console.log(SEP)
process.exit(0)
