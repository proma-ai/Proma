/**
 * Suggestion 真实场景验证（修复后）
 * 在隔离目录中验证完整链路：
 * 1. 五类建议是否都能触发（含修复后的 todo）
 * 2. 边界误报是否消除（以后再说/明天再说吧/弱意图 repeat）
 * 3. accepted correction → memory 回流
 * 4. 频率学习 + never 屏蔽
 * 5. 真实文件不被污染
 */
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { getSuggestionsPath, getCorrectionsPath, getMemoryRootDir } from '../apps/electron/src/main/lib/config-paths'
import { resetSuggestionsCache, setSuggestionsEnabled } from '../apps/electron/src/main/lib/suggest/feedback'
import { evaluateSessionSuggestions, handleSuggestionFeedback, getSuggestionStats, listSuggestionsForUI } from '../apps/electron/src/main/lib/suggest/service'
import { corrections } from '../apps/electron/src/main/lib/memory/service'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function clean(file: string): Promise<void> {
  if (existsSync(file)) rmSync(file)
  if (existsSync(file + '.bak')) rmSync(file + '.bak')
}

async function main(): Promise<void> {
  console.log('\n=== Suggestion 真实场景验证（隔离目录）===\n')

  // 隔离
  const cfg = process.env.PROMA_CONFIG_DIR ?? '/tmp/proma-suggest-verify'
  mkdirSync(cfg, { recursive: true })
  const memRoot = process.env.PROMA_MEMORY_DIR ?? '/tmp/proma-suggest-verify-mem'
  mkdirSync(memRoot, { recursive: true })
  await clean(getSuggestionsPath())
  await clean(getCorrectionsPath())
  resetSuggestionsCache()
  setSuggestionsEnabled(true)

  console.log('1. 五类建议触发（含修复后的 todo）')
  const correction = await evaluateSessionSuggestions([{ role: 'user', content: '以后不要用 var 声明变量' }], { sessionId: 'v1' })
  check('correction 触发', correction.length === 1 && correction[0]?.kind === 'correction')
  const followup = await evaluateSessionSuggestions([{ role: 'user', content: '这个 UI 修补任务明天继续' }], { sessionId: 'v2' })
  check('followup 触发', followup.length === 1 && followup[0]?.kind === 'followup')
  const automation = await evaluateSessionSuggestions([{ role: 'user', content: '每天自动帮我汇总 GitHub PR 状态' }], { sessionId: 'v3' })
  check('automation 触发', automation.length === 1 && automation[0]?.kind === 'automation')
  const todo = await evaluateSessionSuggestions([{ role: 'user', content: '这个功能还没做完' }], { sessionId: 'v4' })
  check('todo 触发（死锁已修复）', todo.length === 1 && todo[0]?.kind === 'todo')
  const repeat = await evaluateSessionSuggestions([{ role: 'user', content: '帮我总结今天的工作' }, { role: 'user', content: '帮我总结一下项目进展' }], { sessionId: 'v5' })
  check('repeat 触发 automation', repeat.length >= 1 && repeat[0]?.kind === 'automation')

  console.log('\n2. 边界误报消除（子代理审查修复）')
  const postpone = await evaluateSessionSuggestions([{ role: 'user', content: '这个问题以后再说吧' }], { sessionId: 'v6' })
  check('"以后再说吧" 不误判 correction', postpone.length === 0)
  const tomorrow = await evaluateSessionSuggestions([{ role: 'user', content: '明天再说吧' }], { sessionId: 'v7' })
  check('"明天再说吧" 不触发 followup', tomorrow.length === 0)
  const weakRepeat = await evaluateSessionSuggestions([{ role: 'user', content: '帮我看看这个文件' }, { role: 'user', content: '帮我看看那个配置' }], { sessionId: 'v8' })
  check('弱意图"看看"不误判 repeat', !weakRepeat.some((r) => r.kind === 'automation'))
  const plain = await evaluateSessionSuggestions([{ role: 'user', content: '帮我写个 hello world' }], { sessionId: 'v9' })
  check('无信号对话该沉默', plain.length === 0)
  const rejection = await evaluateSessionSuggestions([{ role: 'user', content: '以后不要用 X', }, { role: 'user', content: '不用了算了' }], { sessionId: 'v10' })
  check('最后一条拒绝则本轮沉默', rejection.length === 0)

  console.log('\n3. accepted correction → memory 回流')
  const c = await evaluateSessionSuggestions([{ role: 'user', content: '以后做架构设计前先调研开源方案' }], { sessionId: 'v11' })
  if (c[0]) {
    const r = handleSuggestionFeedback(c[0].id, 'accepted')
    check('接受成功', r.ok === true)
    const pending = corrections('pending')
    check('memory correction 已写入', pending.length === 1)
    check('rule 规范化', pending[0]?.rule === '做架构设计前先调研开源方案', pending[0]?.rule)
    check('correction 权重上升', getSuggestionStats().typeWeights.correction > 1.0)
  } else {
    check('correction 建议生成', false)
  }

  console.log('\n4. 频率学习 + never 屏蔽')
  const c2 = await evaluateSessionSuggestions([{ role: 'user', content: '以后回复用中文' }], { sessionId: 'v12' })
  if (c2[0]) {
    const before = getSuggestionStats().typeWeights.correction
    handleSuggestionFeedback(c2[0].id, 'ignored')
    const after = getSuggestionStats().typeWeights.correction
    check('ignored 后权重下降', after < before, `${before} → ${after}`)
  }
  const n = await evaluateSessionSuggestions([{ role: 'user', content: '明天继续这个测试任务' }], { sessionId: 'v13' })
  if (n[0]) {
    handleSuggestionFeedback(n[0].id, 'never')
    const again = await evaluateSessionSuggestions([{ role: 'user', content: '明天继续这个测试任务' }], { sessionId: 'v14' })
    check('never 后同类不再建议', again.length === 0)
  } else {
    check('followup 建议生成', false)
  }

  console.log('\n5. 隔离验证（真实目录未被污染）')
  const realPath = '/Users/moxianbao/.proma-dev/suggestions.json'
  check('真实 ~/.proma-dev/suggestions.json 不存在', !existsSync(realPath))
  check('隔离目录 suggestions.json 存在', existsSync(getSuggestionsPath()))

  console.log('\n=== 结果: ' + passed + ' pass / ' + failed + ' fail ===\n')
  process.exit(failed > 0 ? 1 : 0)
}

void main()
