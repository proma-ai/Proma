/**
 * Memory Persona — L3 用户画像生成与增量更新
 *
 * 从已沉淀的 L1 atoms 用 LLM 生成/更新 persona.md：
 * - 首次生成：基于全部（或代表性）atoms 构建画像
 * - 增量更新：基于已有 persona + 新 atoms，只追加/修正变化，不重写稳定内容
 *
 * 设计原则（参考 TencentDB-Agent-Memory 的 persona 生成 + 安全要求）：
 * - 保留证据链：每条画像结论来自哪些 atoms（可审计）
 * - 不虚构：只写 atoms 中明确出现的
 * - 稳定优先：增量更新时保留已确认内容，只处理新证据
 * - Markdown 白盒：人类可读、可编辑
 */

import { callLlm } from './extractor'
import { readAllAtoms, readPersonaRaw } from './store'
import type { MemoryAtom } from '@proma/shared'

// ===== Prompt =====

const PERSONA_SYSTEM_PROMPT = `你是用户画像构建器。基于「长期记忆条目（L1 atoms）」构建或更新用户的长期画像（persona）。

规则：
1. 只使用提供的记忆条目中"明确出现"的信息，禁止推测、编造、补常识。
2. 输出必须是 Markdown 格式，结构如下：

# 用户画像

## 用户
<称呼/姓名；未知则写"用户">

## 一句话定位
<一句话概括用户身份/工作重点，30 字内>

## 长期偏好
- <偏好1>
- <偏好2>

## 交互协议
- <用户希望 Agent 如何工作，如"先调研再动手"、"优先中文"；无则写"（暂无明确交互协议）">

## 演进轨迹
- <重要阶段/变化，如"2026-08：开始做 proactive memory">；无则写"（暂无）"

3. 偏好/协议每条 10-40 字，直接可执行，不要模棱两可。
4. 如果提供已有 persona，合并时保留稳定内容，只更新有证据支撑的变化。
5. **证据溯源（必须）**：每条偏好/协议/定位/演进条目末尾追加「（src: atom_xxx,atom_yyy）」,
   src 必须是输入记忆条目标号（如 [1] 对应 id: atom_xxx）。如果某条结论无法对应任何输入条目，标注「（src: 未知）」。
   不要把 src 当成画像内容本身，它是用于溯源的行内标注。
6. 只输出 Markdown 本身，不要额外解释。`

/** 从 atoms 构造 persona 生成的输入文本 */
function formatAtomsForPersona(atoms: MemoryAtom[], maxAtoms = 40): string {
  const lines = atoms.slice(0, maxAtoms).map((a, i) => {
    return `${i + 1}. [${a.type}|pri=${a.priority}] ${a.content}（来源: ${new Date(a.createdAt).toISOString().slice(0, 10)}，id: ${a.id}）`
  })
  return lines.join('\n')
}

// ===== 生成 =====

/**
 * 生成 persona.md（首次或无 LLM 时用规则版兜底）。
 * 返回生成的 markdown；失败时返回 undefined（调用方决定是否兜底）。
 */
export async function generatePersona(opts: { existing?: string; maxAtoms?: number } = {}): Promise<string | undefined> {
  const atoms = readAllAtoms({ includeUnconfirmed: false })
    .filter((a) => a.type !== 'todo_context') // 任务上下文太临时，不进入画像
    .sort((a, b) => b.priority - a.priority)

  if (atoms.length === 0) return undefined

  const atomText = formatAtomsForPersona(atoms, opts.maxAtoms)
  const existingText = opts.existing?.trim()
  const userText = existingText
    ? `已有 persona：\n---\n${existingText}\n---\n\n新记忆条目：\n${atomText}\n\n请合并更新 persona，保留稳定内容，只更新有证据的变化。`
    : `记忆条目：\n${atomText}\n\n请生成初始 persona。`

  const raw = await callLlm(PERSONA_SYSTEM_PROMPT, userText, { temperature: 0.3, maxTokens: 4096 })
  if (!raw) return undefined
  const cleaned = cleanPersonaMarkdown(raw)
  return cleaned || undefined
}

/** 清理 LLM 输出的 markdown（去掉围栏/多余空白，确保以 # 开头） */
export function cleanPersonaMarkdown(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]?.trim() ?? text
  // 去掉可能的前置解释（LLM 偶尔会在 markdown 前加一句"以下是..."）
  const hashIndex = text.indexOf('#')
  if (hashIndex > 0 && hashIndex < 200) {
    text = text.slice(hashIndex).trim()
  }
  return text
}

// ===== 规则版兜底（无 LLM 时） =====

/** 无 LLM 时用规则拼一个基础 persona（从 atoms 提取姓名/偏好/协议） */
export function buildPersonaFromRules(): string | undefined {
  const atoms = readAllAtoms({ includeUnconfirmed: false })
  if (atoms.length === 0) return undefined

  const lines: string[] = ['# 用户画像', '', '## 用户', '']
  // 尝试找姓名
  const nameAtom = atoms.find((a) => /叫|姓名|名字|我是/i.test(a.content) && a.type === 'fact')
  lines.push(nameAtom ? extractName(nameAtom.content) : '用户')
  lines.push('', '## 一句话定位', '')
  const fact = atoms.find((a) => a.type === 'fact')
  lines.push(fact ? fact.content.slice(0, 40) : '（待 LLM 生成）')
  lines.push('', '## 长期偏好', '')
  const prefs = atoms.filter((a) => a.type === 'preference').slice(0, 5)
  if (prefs.length > 0) for (const p of prefs) lines.push(`- ${p.content.slice(0, 50)}（src: ${p.id}）`)
  else lines.push('- （暂无明确偏好）')
  lines.push('', '## 交互协议', '')
  const corrections = atoms.filter((a) => a.type === 'correction').slice(0, 3)
  if (corrections.length > 0) for (const c of corrections) lines.push(`- ${c.content.slice(0, 60)}（src: ${c.id}）`)
  else lines.push('- （暂无明确交互协议）')
  lines.push('', '## 演进轨迹', '', '- （暂无）')
  return lines.join('\n')
}

/** 从"我叫 Conrad，独立开发者"类内容提取姓名 */
export function extractName(content: string): string {
  const match = content.match(/(?:叫|姓名是|名字是|我是)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_]{0,20})/)
  if (match?.[1]) return match[1]
  return content.slice(0, 20)
}

/**
 * 从 persona markdown 中提取每条画像条目的来源标注（证据溯源）。
 * 返回 { text, sources: atomId[] } 列表；无标注时 sources 为空数组。
 */
export function extractPersonaSources(markdown: string): Array<{ text: string; sources: string[] }> {
  const lines = markdown.split('\n')
  const result: Array<{ text: string; sources: string[] }> = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue
    const srcMatch = trimmed.match(/（src:\s*([^）]+)）\s*$/)
    let text = trimmed.replace(/^- /, '').trim()
    const sources: string[] = []
    if (srcMatch && srcMatch[1]) {
      text = trimmed.slice(0, srcMatch.index ?? trimmed.length).replace(/^- /, '').trim()
      sources.push(...srcMatch[1].split(',').map((s) => s.trim()).filter((s) => s.startsWith('atom_')))
    }
    result.push({ text, sources })
  }
  return result
}
