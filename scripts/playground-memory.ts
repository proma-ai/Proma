/**
 * Proactive Memory 交互式体验（推荐）
 * 运行: PROMA_DEV=1 bun run scripts/playground-memory.ts
 *
 * 体验流程：
 *   1. 「会话一」：你输入几条消息（或直接回车用示例），每轮后自动 LLM 提取记忆
 *   2. 「会话二」：假装新会话，你提问，脚本展示：召回的记忆上下文 + 基于记忆生成的回答
 *
 * 需要 .env 已配置 MEMORY_LLM_API_KEY（DeepSeek v4 Flash）
 */

import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { extractAndCapture, contextForMessage } from '../apps/electron/src/main/lib/memory/service'
import { getMemoryLlmConfig } from '../apps/electron/src/main/lib/memory/extractor'

const rl = readline.createInterface({ input, output })

const SESSION_ONE = 'playground-session-1'
const SESSION_TWO = 'playground-session-2'

/** 用 DeepSeek 基于注入的 memory_context 生成回答（模拟 Agent 使用记忆） */
async function answerWithMemory(userQuestion: string): Promise<string> {
  const memoryBlock = contextForMessage(userQuestion)
  const config = getMemoryLlmConfig()
  const systemPrompt = `你是 Proma Agent。用户开启了一个新会话，你拥有长期记忆。
以下是本次召回的相关记忆（<memory_context>），基于这些记忆回答用户；如果记忆与问题无关，诚实说不知道。\n\n${memoryBlock || '（本次未召回相关记忆）'}`
  try {
    const resp = await fetch(`${config!.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config!.apiKey}` },
      body: JSON.stringify({
        model: config!.model,
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
console.log('══════════════════════════════════════════════')
console.log('  Proma Proactive Memory 交互式体验')
console.log('══════════════════════════════════════════════')
console.log('')
console.log('【阶段 1】会话一 —— 我会自动记住你提到的信息')
console.log('直接输入你想告诉我的内容（例如：我叫小明，喜欢用 Rust，做后端开发）')
console.log('每轮输入后回车，我会自动提取记忆。输入 空行 结束本阶段。')
console.log('')

const session1: Array<{ role: 'user' | 'assistant'; content: string }> = []
let phase1Done = false

while (!phase1Done) {
  const answer = await rl.question('你 > ')
  if (!answer.trim()) {
    phase1Done = true
    break
  }
  session1.push({ role: 'user', content: answer })
  session1.push({ role: 'assistant', content: '好的，我记下来了。' })

  console.log('  ⟳ 正在提取记忆...')
  const result = await extractAndCapture(session1.slice(-6), { sessionId: SESSION_ONE, workspaceSlug: 'proactiveagent' })
  console.log(`  ✅ 已提取: ${result.storedCount} 条新增 (mode=${result.mode})${result.corrections ? `, ${result.corrections} 条纠正候选` : ''}`)
}

console.log('')
console.log('──────────────────────────────────────────────')
console.log('【阶段 2】会话二（全新会话）—— 提问，观察我如何用记忆回答')
console.log('输入你的问题（例如：我叫什么名字？ / 我偏好什么技术栈？）')
console.log('输入 空行 结束。')
console.log('')

while (true) {
  const question = await rl.question('新会话你 > ')
  if (!question.trim()) break

  console.log('')
  console.log('  ┌─ 召回的 memory_context 注入 ─────────────')
  const block = contextForMessage(question)
  console.log(block ? `  ${block.replace(/\n/g, '\n  ')}` : '  （未命中记忆）')
  console.log('  └──────────────────────────────────────────')
  console.log('')

  const text = await answerWithMemory(question)
  console.log('  Agent 回答:')
  console.log(`  ${text.replace(/\n/g, '\n  ')}`)
  console.log('')
}

console.log('体验结束。记忆已存入 ~/.proma-dev/memory/（开发模式），可用脚本查看。')
process.exit(0)
