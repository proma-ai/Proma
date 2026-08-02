/**
 * Memory LLM 提取端到端验证（真实调用）
 * 运行: PROMA_DEV=1 bun run scripts/smoke-extract-llm.ts
 * 验证：LLM 配置读取 → 对话消息 → LLM 提取候选 → 去重写入 → 检索命中
 */

import { extractAndCapture, searchAsText, stats, isLlmConfigured } from '../apps/electron/src/main/lib/memory/service'

console.log('=== Memory LLM 提取端到端验证 ===\n')

console.log('1) LLM 配置检查:', isLlmConfigured() ? '✅ 已配置' : '❌ 未配置')
console.log()

// 模拟一轮真实风格的对话
const messages = [
  { role: 'user' as const, content: 'Conrad 你好，我在用 DeepSeek 做个人项目，平时喜欢用 TypeScript 写代码，最近在研究给 Agent 加记忆系统。' },
  { role: 'assistant' as const, content: '好的，我记住了。你正在研究 Agent 记忆系统，用 TypeScript 和 DeepSeek。' },
  { role: 'user' as const, content: '对，以后你在写代码时记得优先用 TypeScript，我不用 JavaScript。另外我更喜欢中文回复。' },
  { role: 'assistant' as const, content: '明白，以后默认 TypeScript + 中文回复。' },
  { role: 'user' as const, content: '下次做架构设计前，先帮我调研一下开源方案再动手，不要直接开始写。' },
]

console.log('2) 触发主动记忆提取（LLM）...')
const result = await extractAndCapture(messages, { sessionId: 'smoke-llm-session', workspaceSlug: 'proactiveagent' })
console.log('  提取结果:', JSON.stringify(result))
console.log()

console.log('3) 检索验证 "TypeScript 语言偏好"...')
console.log('  ' + searchAsText({ query: 'TypeScript 语言偏好', limit: 5 }).replace(/\n/g, '\n  '))
console.log()

console.log('4) 检索验证 "调研开源方案"...')
console.log('  ' + searchAsText({ query: '调研开源方案', limit: 5 }).replace(/\n/g, '\n  '))
console.log()

console.log('5) 统计:')
const s = stats()
console.log('  atomCount:', s.atomCount, '| byType:', JSON.stringify(s.byType), '| pendingCorrections:', s.pendingCorrections)

console.log('\n=== 验证完成 ===')
