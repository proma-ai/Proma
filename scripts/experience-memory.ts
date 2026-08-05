/**
 * 完整 Proactive Memory 体验（替你跑一遍真实流程）
 * 运行: PROMA_DEV=1 bun run scripts/experience-memory.ts
 *
 * 会话一：输入你的真实背景 → 自动 LLM 提取记忆 → persona 生成
 * 会话二：全新会话提问 → 召回注入 → 真实 DeepSeek 基于记忆回答
 */

import { extractAndCapture, contextForMessage } from '../apps/electron/src/main/lib/memory/service'
import { readAllAtoms, readPersonaRaw, getMemoryStats } from '../apps/electron/src/main/lib/memory/store'
import { getMemoryLlmConfig } from '../apps/electron/src/main/lib/memory/extractor'

const SEP = '─'.repeat(58)

async function answerWithMemory(userQuestion: string): Promise<string> {
  const memoryBlock = contextForMessage(userQuestion)
  const config = getMemoryLlmConfig()
  if (!config) return '（未配置 LLM）'
  const systemPrompt = `你是 Proma Agent。用户开启了一个新会话，没有任何历史上下文，你只拥有长期记忆。
以下是本次召回的相关记忆（<memory_context>），基于这些记忆回答用户；如果记忆与问题无关，诚实说不知道。

${memoryBlock || '（本次未召回相关记忆）'}`
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
console.log('  Proactive Memory · 完整真实体验（替你跑一遍）')
console.log('══════════════════════════════════════════════════════')
console.log('')

// ===== 会话一：输入真实背景 =====
console.log(SEP)
console.log('【会话一】你告诉 Agent 自己的真实情况（自动记忆）')
console.log(SEP)
console.log('')

const session1: Array<{ role: 'user' | 'assistant'; content: string }> = []

const turns = [
  '我叫 Conrad，是一名独立开发者，主要用 TypeScript 和 Rust 做全栈开发',
  '最近在给开源项目 Proma 做 Proactive Agent 能力，也就是主动记忆和主动回忆',
  '这个项目参考过 TencentDB Agent Memory 的分层记忆，还有清华 ProactiveAgent 论文的误报控制',
  '我还调研过 Nowledge Mem，借鉴了它的 PreCompact 捕获和 Working Memory 工作记忆两个设计',
  '以后帮我做事的时候，希望你先给方案再动手，架构设计前先调研开源方案',
]

for (const text of turns) {
  session1.push({ role: 'user', content: text })
  session1.push({ role: 'assistant', content: '好的，我记下来了。' })
  console.log(`你 > ${text.slice(0, 40)}${text.length > 40 ? '...' : ''}`)
  const r = await extractAndCapture(session1.slice(-6), { sessionId: 'experience-s1', workspaceSlug: 'proactiveagent' })
  console.log(`  ⟳ 自动提取: +${r.storedCount} 条 (mode=${r.mode})`)
  console.log('')
}

// 等 persona 异步生成
await new Promise((r) => setTimeout(r, 6000))

// ===== 展示沉淀 =====
console.log(SEP)
console.log('【记忆落盘】会话一结束后实际沉淀了什么')
console.log(SEP)
console.log('')
const atoms = readAllAtoms({ includeUnconfirmed: true })
console.log(`L1 原子记忆（${atoms.length} 条）:`)
for (const a of atoms.slice(0, 8)) {
  console.log(`  [${a.type}|pri=${a.priority}] ${a.content.slice(0, 55)}`)
}
const stats = getMemoryStats()
console.log(`\n统计: atomCount=${stats.atomCount}, persona=${stats.personaExists ? '✓' : '✗'}`)
const personaRaw = readPersonaRaw()
if (personaRaw) {
  console.log('\nL3 用户画像 (profile.md):')
  console.log(personaRaw.slice(0, 500))
}
console.log('')

// ===== 会话二：全新会话提问 =====
console.log(SEP)
console.log('【会话二】全新会话（无任何历史）→ 提问，看记忆召回')
console.log(SEP)
console.log('')

const questions = [
  '你还记得我是谁吗？我是做什么的？',
  '我在做的项目参考过哪些方案？',
  '你帮我做事时，应该注意什么工作习惯？',
]

for (const q of questions) {
  console.log(`新会话你 > ${q}`)
  const block = contextForMessage(q)
  console.log('')
  console.log('  召回注入:')
  console.log(block ? `  ${block.replace(/\n/g, '\n  ')}` : '  （未命中）')
  console.log('')
  const answer = await answerWithMemory(q)
  console.log(`  Agent 回答 > ${answer.replace(/\n/g, '\n  ')}`)
  console.log('')
}

console.log(SEP)
console.log('体验结束。这就是实际效果。')
console.log(SEP)
process.exit(0)
