/**
 * Proactive Memory 体验演示（基于当前记忆库）
 * 运行: PROMA_DEV=1 PROMA_MEMORY_EMBEDDING=local bun run scripts/demo-recall.ts
 *
 * 演示 hybrid 召回（keyword + embedding + 改写 + 规则）+ 真实回答
 */

import { searchMemoriesHybrid } from '../apps/electron/src/main/lib/memory/recall'
import { getMemoryLlmConfig } from '../apps/electron/src/main/lib/memory/extractor'
import { getMemoryStats } from '../apps/electron/src/main/lib/memory/store'

const SEP = '─'.repeat(58)

async function demo(q: string): Promise<void> {
  const r = await searchMemoriesHybrid({ query: q, limit: 5 })
  const block = r.hits.map((h) => `- [${h.atom.type}] ${h.atom.content}`).join('\n')
  const cfg = getMemoryLlmConfig()
  const resp = await fetch(`${cfg!.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg!.apiKey}` },
    body: JSON.stringify({
      model: cfg!.model,
      messages: [
        { role: 'system', content: `你是 Proma Agent。新会话无历史，只能靠记忆回答。\n\n<memory_context>\n${block || '（无召回）'}\n</memory_context>` },
        { role: 'user', content: q },
      ],
      max_tokens: 400,
      temperature: 0.4,
    }),
  })
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
  console.log(`Q: ${q}`)
  console.log(`  召回 ${r.hits.length} 条 [${r.strategy}]`)
  console.log(`  A: ${(data.choices?.[0]?.message?.content ?? '（空）').replace(/\n/g, ' ').slice(0, 220)}`)
  console.log('')
}

console.log('')
console.log('══════════════════════════════════════════════════════')
console.log('  Proactive Memory · 体验演示')
console.log('══════════════════════════════════════════════════════')
console.log('')

const stats = getMemoryStats()
console.log(`记忆库: ${stats.atomCount} 条 | 3 个项目（CodeLens/ShopGo/DocFlow）`)
console.log('')
console.log(SEP)
console.log('【场景 1】多项目记忆（跨会话回忆）')
console.log(SEP)
console.log('')
await demo('我在做的三个项目分别是什么？')

console.log(SEP)
console.log('【场景 2】近义词召回（难点：锁→分段锁）')
console.log(SEP)
console.log('')
await demo('ShopGo 订单拆分用什么锁？')

console.log(SEP)
console.log('【场景 3】跨项目交叉推理')
console.log(SEP)
console.log('')
await demo('CodeLens 和 ShopGo 最近有什么交集？')

console.log(SEP)
console.log('【场景 4】技术选型细节')
console.log(SEP)
console.log('')
await demo('DocFlow 协同编辑用什么方案？')

console.log(SEP)
console.log('【场景 5】工作偏好（语义问句）')
console.log(SEP)
console.log('')
await demo('我有什么工作习惯？')

console.log(SEP)
console.log('【场景 6】过期记忆检测')
console.log(SEP)
console.log('')
await demo('那个天气小程序还在维护吗？')

console.log(SEP)
console.log('演示结束。')
console.log(SEP)
process.exit(0)
