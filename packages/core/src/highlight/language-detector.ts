/**
 * 代码语言自动检测
 *
 * 当 fenced code block 没有显式语言标识时，用于猜测最可能的语言。
 * 使用 highlight.js 按需注册的常用语言做 highlightAuto，置信度门槛 5。
 *
 * Mermaid 不在此处识别 —— 调用方应先用 `apps/electron/.../mermaid-detection.ts`
 * 中的 `shouldRenderMermaidCodeBlock` 判断，未命中再调用本函数检测其他语言。
 * 这样避免与 mermaid-detection 维护两份 mermaid 关键字列表。
 *
 * 仅在 language 为空字符串时调用。识别失败回退到 'text'。
 */

import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import java from 'highlight.js/lib/languages/java'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/** 注册检测候选语言（只注册一次） */
let registered = false
function ensureRegistered(): void {
  if (registered) return
  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('c', c)
  hljs.registerLanguage('cpp', cpp)
  hljs.registerLanguage('csharp', csharp)
  hljs.registerLanguage('css', css)
  hljs.registerLanguage('go', go)
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('java', java)
  hljs.registerLanguage('kotlin', kotlin)
  hljs.registerLanguage('markdown', markdown)
  hljs.registerLanguage('python', python)
  hljs.registerLanguage('ruby', ruby)
  hljs.registerLanguage('rust', rust)
  hljs.registerLanguage('shell', shell)
  hljs.registerLanguage('sql', sql)
  hljs.registerLanguage('swift', swift)
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('xml', xml)
  hljs.registerLanguage('yaml', yaml)
  registered = true
}

/** highlightAuto 的候选子集，与 ensureRegistered 保持一致 */
const DETECT_LANGS = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'go',
  'javascript', 'json', 'java', 'kotlin', 'markdown',
  'python', 'ruby', 'rust', 'shell', 'sql', 'swift',
  'typescript', 'xml', 'yaml',
]

/** highlightAuto 置信度门槛：低于此值视为无法识别 */
const RELEVANCE_THRESHOLD = 5

/**
 * 自动检测代码语言
 * - 走 highlight.js highlightAuto + 置信度门槛
 * - 识别失败返回 'text'
 *
 * @param code 代码内容
 * @returns 语言标识，可直接传给 Shiki
 */
export function detectLanguage(code: string): string {
  const trimmed = code.trim()
  if (!trimmed) return 'text'

  ensureRegistered()
  try {
    const result = hljs.highlightAuto(trimmed, DETECT_LANGS)
    if (result.relevance >= RELEVANCE_THRESHOLD && result.language) {
      return result.language
    }
  } catch {
    // hljs 解析异常时静默回退
  }
  return 'text'
}
