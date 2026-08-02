/**
 * Proactive Memory 自动演示（无交互，直接看完整链路）
 * 运行: PROMA_DEV=1 bun run scripts/demo-memory.ts
 */

import { extractAndCapture, contextForMessage } from '../apps/electron/src/main/lib/memory/service'
import { getMemoryLlmConfig } from '../apps/electron/src/main/lib/memory/extractor'
import { readAllAtoms, getMemoryStats, readPersonaRaw, listCorrections } from '../apps/electron/src/main/lib/memory/store'

const SEP = '─'.repeat(58)

async function answerWithMemory(userQuestion: string): Promise<string> {
  const memoryBlock = contextForMessage(userQuestion)
  const config = getMemoryLlmConfig()
  if (!config) return '（未配置 LLM）'
  const systemPrompt = `你是 Proma Agent。用户开启了一个新会话，你拥有长期记忆。
以下是本次召回的相关记忆（<memory_context>），基于这些记忆回答用户；如果记忆与问题无关，诚实说不知道。\n\n${memoryBlock || '（本次未召回相关记忆）'}`
  try {
    const resp = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuestion },
        ],
        max_tokens: 1024,
        temperature: 0.4,
      }),
    })
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || '（模型未返回内容）'
  } catch (error) {
    return `（调用模型失败: ${error instanceof Error ? error.message : error}）`
  }
}

console.log('')
console.log('══════════════════════════════════════════════════════')
console.log('  Proma Proactive Memory · 自动演示')
console.log('══════════════════════════════════════════════════════')
console.log('')

// ===== 阶段 1：会话一（自动记忆） =====
console.log(SEP)
console.log('【阶段 1】会话一 —— 你在跟 Agent 聊自己的事，每轮自动提取记忆')
console.log(SEP)
console.log('')

const session1: Array<{ role: 'user' | 'assistant'; content: string }> = []

const turns = [
  '我叫 Conrad，是独立开发者，主要用 TypeScript 和 Rust 做全栈开发',
  '最近在给 Proma 做 proactive memory 功能，做架构设计前喜欢先调研开源方案再动手',
  '对了，以后写代码记得优先用 TypeScript，不用 JavaScript',
]

for (const text of turns) {
  session1.push({ role: 'user', content: text })
  session1.push({ role: 'assistant', content: '好的，我记下来了。' })
  console.log(`你 > ${text}`)
  console.log('  ⟳ 自动提取记忆...')
  const r = await extractAndCapture(session1.slice(-6), { sessionId: 'demo-auto-1', workspaceSlug: 'proactiveagent' })
  console.log(`  ✅ 新增 ${r.storedCount} 条, 纠正 ${r.corrections}, mode=${r.mode}`)
  console.log('')
}

// ===== 展示已沉淀的记忆 =====
console.log(SEP)
console.log('【记忆落盘】会话一结束后，~/.proma-dev/memory/ 里有什么')
console.log(SEP)
console.log('')
const atoms = readAllAtoms({ includeUnconfirmed: true })
console.log(`L1 原子记忆（${atoms.length} 条）:`)
for (const a of atoms) {
  console.log(`  [${a.type}|pri=${a.priority}] ${a.content}`)
}
const stats = getMemoryStats()
console.log(`\n统计: atomCount=${stats.atomCount}, pendingCorrections=${stats.pendingCorrections}, personaExists=${stats.personaExists}`)
console.log('')

// ===== 阶段 2：会话二（主动回忆 + 基于记忆回答） =====
console.log(SEP)
console.log('【阶段 2】全新会话 —— 没有任何历史上下文，提问验证记忆召回')
console.log(SEP)
console.log('')

const questions = [
  '你还记得我是谁吗？用什么技术栈？',
  '我做架构设计前有什么偏好？',
  '写代码时你该优先用什么语言？',
]

for (const q of questions) {
  console.log(`新会话你 > ${q}`)
  const block = contextForMessage(q)
  console.log('')
  console.log('  召回的 memory_context 注入:')
  console.log(block ? `  ${block.replace(/\n/g, '\n  ')}` : '  （未命中）')
  console.log('')
  const answer = await answerWithMemory(q)
  console.log(`  Agent 回答 > ${answer.replace(/\n/g, '\n  ')}`)
  console.log('')
}

console.log(SEP)
console.log('演示结束。这就是"主动记忆 + 主动回忆"的完整效果。')
console.log(SEP)
process.exit(0)
