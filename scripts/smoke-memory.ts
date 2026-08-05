/**
 * Memory MVP 冒烟验证脚本（开发模式）
 * 运行: PROMA_DEV=1 bun run scripts/smoke-memory.ts
 * 验证：写入原子记忆 → 关键词检索 → 上下文注入 → 统计
 */

import {
  writeAtom,
  readAllAtoms,
  getMemoryStats,
  writePersona,
  readPersonaRaw,
  addCorrection,
  listCorrections,
  updateCorrectionStatus,
} from '../apps/electron/src/main/lib/memory/store'
import {
  searchMemoriesByKeyword,
  buildMemoryContextForMessage,
} from '../apps/electron/src/main/lib/memory/recall'
import { captureCandidate } from '../apps/electron/src/main/lib/memory/service'

console.log('=== Memory MVP 冒烟验证 ===\n')

// 1. 写入原子记忆
console.log('1) 写入原子记忆...')
writeAtom({ content: '用户 Conrad 使用 DeepSeek 作为默认 LLM，偏好中文交流', type: 'fact', priority: 70 })
writeAtom({ content: '用户喜欢在实现前先调研开源方案，再动手编码', type: 'preference', priority: 60 })
writeAtom({ content: '用户正在开发 Proma 的 proactive memory 能力', type: 'todo_context', priority: 80 })
writeAtom({ content: '用户要求：不要直接要 API key，应让用户写本地 .env', type: 'correction', priority: 90, confirmed: true })
console.log('  已写入 4 条\n')

// 2. 检索
console.log('2) 检索"DeepSeek 模型"...')
const r1 = searchMemoriesByKeyword({ query: 'DeepSeek 模型', limit: 3 })
for (const hit of r1.hits) {
  console.log(`  [${hit.atom.type}|${hit.score.toFixed(2)}] ${hit.atom.content}`)
}
console.log()

console.log('3) 检索"调研方案"...')
const r2 = searchMemoriesByKeyword({ query: '调研方案 编码', limit: 3 })
for (const hit of r2.hits) {
  console.log(`  [${hit.atom.type}|${hit.score.toFixed(2)}] ${hit.atom.content}`)
}
console.log()

// 3. 上下文注入
console.log('4) 注入上下文（模拟用户消息"你还记得我用的什么模型吗"）...')
const block = buildMemoryContextForMessage('你还记得我用的什么模型吗')
console.log(block ? `  ${block.replace(/\n/g, '\n  ')}` : '  （无命中，未注入）')
console.log()

// 4. 去重
console.log('5) 去重验证（再写一条相似记忆）...')
const before = readAllAtoms().length
const dedupResult = captureCandidate({
  content: '用户 Conrad 使用 DeepSeek 作为默认 LLM，偏好中文交流',
  type: 'fact',
  priority: 75,
})
const after = readAllAtoms().length
console.log(`  写入前 ${before} 条，写入后 ${after} 条（${dedupResult.deduplicated ? '✅ 去重生效' : '❌ 未去重'}）`)
console.log()

// 5. persona
console.log('6) 写入 persona...')
writePersona(`# 用户画像

## 用户
Conrad

## 一句话定位
独立开发者，正在为 Proma 实现 proactive agent 能力。

## 长期偏好
- 使用 DeepSeek 作为默认 LLM
- 中文交流
- 实现前先调研

## 交互协议
- 不要直接要 API key，写本地 .env
`)
console.log(`  读取到 ${readPersonaRaw()?.length ?? 0} 字符\n`)

// 6. corrections
console.log('7) 行为纠正候选...')
addCorrection({ raw: '以后不要直接要 API key', rule: '涉及密钥时让用户写本地 .env', sessionId: 'test' })
const pending = listCorrections('pending')
console.log(`  待确认纠正: ${pending.length} 条`)
if (pending[0]) {
  updateCorrectionStatus(pending[0].id, 'active')
  console.log(`  已确认 ${pending[0].id} → active`)
}
console.log()

// 7. stats
console.log('8) 统计:')
console.log(' ', JSON.stringify(getMemoryStats(), null, 2))

console.log('\n=== 冒烟验证完成 ===')
