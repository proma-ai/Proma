/**
 * Suggestion 端到端冒烟脚本
 *
 * 模拟完整链路（不启动 Electron，直接用模块）：
 * 1. 用户消息 → evaluateSessionSuggestions → 生成建议并持久化
 * 2. 三态反馈：接受 / 忽略 / 不再建议
 * 3. 频率学习：忽略 → 权重下降；连续忽略 → 自动静默
 *
 * 运行：PROMA_DEV=1 bun run scripts/smoke-suggest.ts
 */

import { resetSuggestionsCache, setSuggestionsEnabled } from '../apps/electron/src/main/lib/suggest/feedback'
import {
  evaluateSessionSuggestions,
  handleSuggestionFeedback,
  listSuggestionsForUI,
  getSuggestionStats,
} from '../apps/electron/src/main/lib/suggest/service'
import { extractSignals, hasStrongSignal } from '../apps/electron/src/main/lib/suggest/signals'
import { applyRules } from '../apps/electron/src/main/lib/suggest/rules'
import { evaluateSuggestions, defaultTypeWeights } from '../apps/electron/src/main/lib/suggest/engine'
import { getSuggestionsPath } from '../apps/electron/src/main/lib/config-paths'
import type { SuggestionsIndex } from '../apps/electron/src/main/lib/suggest/types'
import { existsSync, rmSync } from 'node:fs'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1
    console.log(`  ✅ ${name}`)
  } else {
    failed += 1
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Suggestion 端到端冒烟 ===\n')

  // 清理上一次运行的测试数据（suggestions.json + .bak），保证从干净状态开始
  const suggestionsPath = getSuggestionsPath()
  if (existsSync(suggestionsPath)) rmSync(suggestionsPath)
  const bakPath = `${suggestionsPath}.bak`
  if (existsSync(bakPath)) rmSync(bakPath)
  resetSuggestionsCache()

  // 1. 信号层
  console.log('1. 信号提取')
  resetSuggestionsCache()
  const correctionMsgs = ['以后不要用 setTimeout 写定时器']
  const signals = extractSignals(correctionMsgs)
  check('纠正信号被提取', signals.some((s) => s.kind === 'correction'))
  check('hasStrongSignal 检测到强信号', hasStrongSignal(correctionMsgs))
  check('无关消息无强信号', !hasStrongSignal(['帮我写个 hello world']))

  // 2. 规则层
  console.log('\n2. 规则应用')
  const matches = applyRules({
    userMessages: correctionMsgs,
    existingAutomationTitles: [],
    existingCorrectionRules: [],
    sopCandidateCount: 0,
  })
  check('纠正规则生成建议', matches.some((m) => m.candidate.kind === 'correction'))
  check('建议标题正确', matches.some((m) => m.candidate.title === '记住这个纠正'))

  // 3. 决策层（引擎）
  console.log('\n3. 决策引擎')
  const index: SuggestionsIndex = {
    version: 1,
    records: [],
    typeWeights: defaultTypeWeights(),
    enabled: true,
  }
  const result = evaluateSuggestions(
    { messages: correctionMsgs.map((c) => ({ role: 'user' as const, content: c })) },
    index,
  )
  check('引擎产出建议', result.candidates.length === 1)
  check('预算 ≤1 条', result.candidates.length <= 1)

  // 4. Service 全链路（persist + feedback）
  console.log('\n4. Service 全链路')
  resetSuggestionsCache()
  setSuggestionsEnabled(true)
  const records = await evaluateSessionSuggestions(
    correctionMsgs.map((c) => ({ role: 'user', content: c })),
    { sessionId: 'smoke-session' },
  )
  check('evaluateSessionSuggestions 持久化建议', records.length === 1)
  const statsBefore = getSuggestionStats()
  check('待展示建议数 = 1', statsBefore.suggestedCount === 1)

  const rec = records[0]
  if (rec) {
    // 忽略 → 权重下降
    const beforeWeight = statsBefore.typeWeights.correction
    handleSuggestionFeedback(rec.id, 'ignored')
    const statsAfter = getSuggestionStats()
    check(
      '忽略后 correction 权重下降',
      statsAfter.typeWeights.correction < beforeWeight,
      `before=${beforeWeight} after=${statsAfter.typeWeights.correction}`,
    )
    check('建议状态变为 ignored', listSuggestionsForUI().find((r) => r.id === rec.id)?.status === 'ignored')
  }

  // 5. 频率学习收敛（连续忽略 → 自动静默）
  console.log('\n5. 频率学习')
  resetSuggestionsCache()
  setSuggestionsEnabled(true)
  for (let i = 0; i < 3; i++) {
    const r = await evaluateSessionSuggestions(
      [`以后不要用 X${i}`].map((c) => ({ role: 'user', content: c })),
      { sessionId: `silence-session-${i}` },
    )
    if (r[0]) handleSuggestionFeedback(r[0].id, 'ignored')
  }
  const silenced = await evaluateSessionSuggestions(
    ['以后不要用 Y'].map((c) => ({ role: 'user', content: c })),
    { sessionId: 'silence-session-final' },
  )
  check('连续忽略 3 次后自动静默', silenced.length === 0)

  // 6. never 永久屏蔽
  console.log('\n6. never 永久屏蔽')
  resetSuggestionsCache()
  setSuggestionsEnabled(true)
  const neverRec = await evaluateSessionSuggestions(
    ['明天继续这个 UI 修补任务'].map((c) => ({ role: 'user', content: c })),
    { sessionId: 'never-session' },
  )
  if (neverRec[0]) {
    handleSuggestionFeedback(neverRec[0].id, 'never')
    const again = await evaluateSessionSuggestions(
      ['明天继续这个 UI 修补任务'].map((c) => ({ role: 'user', content: c })),
      { sessionId: 'never-session-2' },
    )
    check('never 后同类不再建议', again.length === 0)
  } else {
    check('never 前置建议生成成功', false)
  }

  console.log(`\n=== 结果: ${passed} pass / ${failed} fail ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
