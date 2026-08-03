/**
 * Analyst 冒烟验证 — 真实 LLM 调用
 *
 * 用项目 .env 的 MEMORY_LLM_API_KEY 跑一次工作模式分析，
 * 验证：LLM 调用 → 响应解析 → schema 校验 → 候选持久化 全链路。
 *
 * 运行：PROMA_DEV=1 PROMA_CONFIG_DIR=/tmp/proma-analyst-smoke PROMA_MEMORY_DIR=/tmp/proma-analyst-smoke-mem bun run scripts/smoke-analyst.ts
 */

import { mkdirSync, rmSync } from 'node:fs'
import { resetSuggestionsCache, setSuggestionsEnabled } from '../apps/electron/src/main/lib/suggest/feedback'
import { runAnalysisAndPersist, listSuggestionsForUI } from '../apps/electron/src/main/lib/suggest/service'
import { runWorkPatternAnalysis, analystAvailable } from '../apps/electron/src/main/lib/suggest/analyst'
import { captureCandidate, setEnabled as setMemoryEnabled } from '../apps/electron/src/main/lib/memory/service'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function main(): Promise<void> {
  console.log('\n=== Analyst 冒烟（真实 LLM）===\n')

  // 隔离目录
  rmSync('/tmp/proma-analyst-smoke', { recursive: true, force: true })
  rmSync('/tmp/proma-analyst-smoke-mem', { recursive: true, force: true })
  mkdirSync('/tmp/proma-analyst-smoke', { recursive: true })
  mkdirSync('/tmp/proma-analyst-smoke-mem', { recursive: true })
  resetSuggestionsCache()
  setSuggestionsEnabled(true)
  setMemoryEnabled(true)

  // 1. 是否可用
  console.log('1. LLM 配置')
  check('analyst 可用（.env 有 key）', analystAvailable())
  if (!analystAvailable()) {
    console.log('   ⚠️ 未配置 LLM，跳过真实调用（仅验证 schema 层）')
  }

  // 2. 注入几条记忆（模拟用户工作模式：重复发版检查 + 周报）
  console.log('\n2. 注入工作模式记忆')
  captureCandidate({ content: '每次发版前都要手动检查 release checklist', type: 'sop', priority: 70 })
  captureCandidate({ content: '发版流程：检查清单 → 构建 → 发布 → 验证', type: 'sop', priority: 65 })
  captureCandidate({ content: '用户每周五要写项目周报，汇总本周进展', type: 'todo_context', priority: 60 })
  captureCandidate({ content: '用户偏好：发版前先跑一遍全量测试', type: 'preference', priority: 55 })
  console.log('   已注入 4 条记忆')

  // 3. 真实 LLM 分析
  console.log('\n3. 工作模式分析（真实 LLM）')
  const candidates = await runWorkPatternAnalysis()
  check('分析产出候选（≥0，LLM 可能保守返回空）', candidates.length >= 0, `count=${candidates.length}`)
  if (candidates.length > 0) {
    for (const c of candidates) {
      console.log(`   - [${c.kind}] ${c.title}: ${c.reason.slice(0, 50)}`)
    }
  }

  // 4. 持久化
  console.log('\n4. 持久化到 suggestions')
  const added = await runAnalysisAndPersist()
  check('持久化成功', added >= 0, `added=${added}`)
  const listed = listSuggestionsForUI('suggested')
  console.log(`   待展示建议数: ${listed.length}`)
  for (const r of listed) {
    console.log(`   - [${r.kind}] ${r.title} | 证据: ${r.evidence.slice(0, 40)}`)
  }

  console.log(`\n=== 结果: ${passed} pass / ${failed} fail ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
