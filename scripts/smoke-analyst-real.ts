/**
 * Analyst 真实数据冒烟：直接用 ~/.proma-dev 的真实记忆跑分析
 * 运行：PROMA_DEV=1 bun run scripts/smoke-analyst-real.ts
 */
import { runWorkPatternAnalysis } from '../apps/electron/src/main/lib/suggest/analyst'

async function main() {
  console.log('=== Analyst 真实数据冒烟 ===')
  const candidates = await runWorkPatternAnalysis()
  console.log('候选数:', candidates.length)
  for (const c of candidates) {
    console.log(`  - [${c.kind}] ${c.title}`)
    console.log(`    理由: ${c.reason}`)
    console.log(`    证据: ${c.evidence}`)
  }
  if (candidates.length === 0) console.log('  未发现可沉淀模式（LLM 保守或记忆无重复模式）')
}
void main()
