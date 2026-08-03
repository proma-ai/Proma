/**
 * P0 修复验证：从真实 SDKMessage 格式 JSONL 提取文本 → 建议引擎评估
 *
 * 复现子代理发现的 bug：JSONL 存 SDK 格式（type/message.content 嵌套），
 * 修复前 evaluateSuggestionsFromRun 用 getAgentSessionMessages（无转换）过滤 role/content 得到空数组。
 * 修复后：getAgentSessionSDKMessages + extractRecentConversationText 正确提取。
 *
 * 运行：PROMA_DEV=1 PROMA_CONFIG_DIR=/tmp/proma-fix-verify bun run scripts/verify-suggest-sdk.ts
 */
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { getSuggestionsPath } from '../apps/electron/src/main/lib/config-paths'
import { resetSuggestionsCache, setSuggestionsEnabled } from '../apps/electron/src/main/lib/suggest/feedback'
import { evaluateSessionSuggestions, handleSuggestionFeedback, getSuggestionStats } from '../apps/electron/src/main/lib/suggest/service'
import { extractRecentConversationText } from '../apps/electron/src/main/lib/suggest/sdk-messages'

// 模拟 SDKMessage 格式的会话消息（与真实 JSONL 结构一致）
function makeSDKMessages(): unknown[] {
  return [
    { type: 'system', subtype: 'init', session_id: 'x' },
    { type: 'user', message: { content: [{ type: 'text', text: '帮我写个排序算法' }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { content: [{ type: 'text', text: '好的，这是一个冒泡排序...' }] }, parent_tool_use_id: null },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] }, parent_tool_use_id: null },
    { type: 'user', message: { content: [{ type: 'text', text: '以后不要用 var 声明变量，用 let/const' }] }, parent_tool_use_id: null },
  ]
}

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function main(): Promise<void> {
  console.log('\n=== P0 修复验证：SDK 格式 → 建议引擎 ===\n')

  const cfg = '/tmp/proma-fix-verify'
  mkdirSync(cfg, { recursive: true })
  if (existsSync(getSuggestionsPath())) rmSync(getSuggestionsPath())
  resetSuggestionsCache()
  setSuggestionsEnabled(true)

  console.log('1. SDK 消息提取（模拟真实 JSONL 结构）')
  const sdk = makeSDKMessages() as Parameters<typeof extractRecentConversationText>[0]
  const recent = extractRecentConversationText(sdk, 30)
  check('提取 3 条对话文本（跳过 tool_result 和 system）', recent.length === 3, `actual=${recent.length}`)
  check('提取 user 文本正确', recent[0]?.content === '帮我写个排序算法')
  check('提取 correction 消息正确', recent[2]?.content.includes('以后不要用 var'))

  console.log('\n2. 建议引擎评估（修复后应有建议）')
  const records = await evaluateSessionSuggestions(recent, { sessionId: 'sdk-fix-sess' })
  check('评估产生建议（修复前为 0）', records.length === 1, `actual=${records.length}`)
  check('建议类型为 correction', records[0]?.kind === 'correction')
  check('标题正确', records[0]?.title === '记住这个纠正')

  console.log('\n3. 无信号消息该沉默')
  const plain = extractRecentConversationText(
    [{ type: 'user', message: { content: [{ type: 'text', text: '帮我写个 hello world' }] }, parent_tool_use_id: null }],
    30,
  )
  const silent = await evaluateSessionSuggestions(plain, { sessionId: 'sdk-silent-sess' })
  check('普通请求无建议', silent.length === 0)

  console.log('\n4. 反馈链路完整')
  if (records[0]) {
    const before = getSuggestionStats().typeWeights.correction
    handleSuggestionFeedback(records[0].id, 'accepted')
    const after = getSuggestionStats().typeWeights.correction
    check('accepted 后权重上升', after > before, `${before} → ${after}`)
  }

  console.log('\n=== 结果: ' + passed + ' pass / ' + failed + ' fail ===\n')
  process.exit(failed > 0 ? 1 : 0)
}

void main()
