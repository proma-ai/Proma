/**
 * Shiki 语法高亮服务
 *
 * 提供懒加载的 Shiki 高亮器单例，支持按需加载语言。
 * 纯逻辑层，不依赖 React。
 *
 * 三套 API：
 * - highlightCode()      异步 HTML，首次初始化 + 按需加载语言
 * - highlightCodeSync()  同步 HTML，初始化完成后零延迟
 * - highlightToTokens()  同步 token 结构，适合逐行 React 渲染（流式最优）
 */

import { createHighlighter, bundledLanguages } from 'shiki'
import type { HighlighterGeneric, BundledLanguage, BundledTheme } from 'shiki'

/** Shiki 高亮器实例类型 */
type ShikiHighlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

/** 默认预加载的语言列表 */
const DEFAULT_LANGS: BundledLanguage[] = [
  'javascript', 'typescript', 'python', 'java', 'json',
  'markdown', 'html', 'css', 'shellscript', 'go', 'rust', 'sql',
  'tsx', 'jsx', 'yaml', 'toml', 'c', 'cpp',
]

/** 默认加载的主题 */
const DEFAULT_THEMES: BundledTheme[] = ['github-light', 'github-dark', 'one-light', 'one-dark-pro']

/** 常见语言别名映射 */
const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  rs: 'rust',
  md: 'markdown',
  tf: 'terraform',
  dockerfile: 'docker',
  plaintext: 'text',
  txt: 'text',
  plain: 'text',
}

/** 高亮选项 */
export interface HighlightOptions {
  /** 代码内容 */
  code: string
  /** 语言标识（如 'typescript'、'py'、'bash'） */
  language: string
  /** Shiki 主题名，默认 'github-dark' */
  theme?: string
}

/** 高亮结果（HTML 字符串） */
export interface HighlightResult {
  /** Shiki 渲染的 HTML 字符串 */
  html: string
  /** 实际使用的语言（经过别名解析和 fallback） */
  language: string
}

/** 不规则语言显示名称（无法通过首字母大写自动生成） */
const DISPLAY_NAMES: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript',
  tsx: 'TSX', jsx: 'JSX',
  py: 'Python', rb: 'Ruby',
  cpp: 'C++', 'c++': 'C++',
  cs: 'C#', csharp: 'C#',
  kt: 'Kotlin', rs: 'Rust',
  sh: 'Shell', zsh: 'Shell',
  yml: 'YAML', md: 'Markdown',
  tf: 'Terraform',
  html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'LESS',
  json: 'JSON', xml: 'XML', sql: 'SQL',
  graphql: 'GraphQL', php: 'PHP',
  plaintext: 'Text', text: 'Text',
}

/** 获取语言显示名称，未匹配的自动首字母大写 */
export function getDisplayName(lang: string): string {
  if (!lang) return 'Code'
  const key = lang.toLowerCase()
  return DISPLAY_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

/** 单个高亮 token */
export interface HighlightToken {
  /** 文本内容 */
  content: string
  /** CSS 颜色值 */
  color?: string
}

/** 按行组织的 token 高亮结果（适合 React 逐行渲染） */
export interface HighlightTokensResult {
  /** 每行的 token 列表 */
  lines: HighlightToken[][]
  /** 代码区域背景色 */
  bgColor: string
  /** 代码区域前景色 */
  fgColor: string
  /** 实际使用的语言 */
  language: string
}

/** 单例高亮器 Promise */
let highlighterPromise: Promise<ShikiHighlighter> | null = null

/** 已 resolve 的高亮器实例缓存（同步访问用） */
let cachedHighlighter: ShikiHighlighter | null = null

/** 高亮器就绪订阅者，初始化完成后一次性触发并清空 */
const readyListeners = new Set<() => void>()

/** 是否已完成首次初始化（同步查询用） */
export function isHighlighterReady(): boolean {
  return cachedHighlighter !== null
}

/**
 * 订阅高亮器就绪事件
 * - 已就绪时立即同步触发回调，返回 noop unsubscribe
 * - 未就绪时入队，初始化完成后触发一次后自动清理
 * 返回 unsubscribe 函数，组件卸载时应调用以避免泄漏
 */
export function onHighlighterReady(callback: () => void): () => void {
  if (cachedHighlighter) {
    callback()
    return () => {}
  }
  readyListeners.add(callback)
  // 触发初始化（如果还没启动）
  void getHighlighter()
  return () => readyListeners.delete(callback)
}

/**
 * 获取或创建 Shiki 高亮器单例
 * 首次调用时懒加载，resolve 后缓存实例供同步使用，并通知所有 ready 订阅者
 */
function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: DEFAULT_THEMES,
      langs: DEFAULT_LANGS,
    }).then((hl) => {
      cachedHighlighter = hl
      // 通知所有等待中的订阅者，触发后清空（一次性事件）
      const listeners = Array.from(readyListeners)
      readyListeners.clear()
      for (const listener of listeners) {
        try {
          listener()
        } catch (error) {
          console.error('[shiki-service] ready listener 抛错:', error)
        }
      }
      return hl
    })
  }
  return highlighterPromise
}

/**
 * 解析语言别名，返回有效的 Shiki 语言标识
 * 未知语言返回 'text'
 */
function resolveLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim()
  const resolved = LANGUAGE_ALIASES[normalized] ?? normalized

  if (resolved === 'text') return 'text'
  if (resolved in bundledLanguages) return resolved
  return 'text'
}

/** 解析已加载的语言，未加载的 fallback 到 text */
function resolveLoadedLanguage(highlighter: ShikiHighlighter, lang: string): string {
  const resolved = resolveLanguage(lang)
  if (resolved === 'text') return 'text'
  return highlighter.getLoadedLanguages().includes(resolved) ? resolved : 'text'
}

/**
 * 解析语言别名并按需加载，返回可直接使用的语言标识
 * 未知语言自动 fallback 到 'text'
 */
async function resolveAndLoadLanguage(highlighter: ShikiHighlighter, lang: string): Promise<string> {
  const resolved = resolveLanguage(lang)

  if (resolved === 'text') return 'text'
  if (highlighter.getLoadedLanguages().includes(resolved)) return resolved

  try {
    await highlighter.loadLanguage(resolved as BundledLanguage)
    return resolved
  } catch {
    console.warn(`[shiki-service] 加载语言 "${resolved}" 失败，回退到 text`)
    return 'text'
  }
}

/**
 * 异步高亮代码，返回 HTML 字符串（首次初始化 + 按需加载语言时使用）
 */
export async function highlightCode(options: HighlightOptions): Promise<HighlightResult> {
  const { code, language, theme = 'github-dark' } = options

  const highlighter = await getHighlighter()
  const resolvedLang = await resolveAndLoadLanguage(highlighter, language)

  const html = highlighter.codeToHtml(code, {
    lang: resolvedLang as BundledLanguage,
    theme: theme as BundledTheme,
  })

  return { html, language: resolvedLang }
}

/**
 * 同步高亮代码，返回 HTML 字符串
 * 返回 null 表示高亮器尚未初始化
 */
export function highlightCodeSync(options: HighlightOptions): HighlightResult | null {
  if (!cachedHighlighter) return null

  const { code, language, theme = 'github-dark' } = options
  const lang = resolveLoadedLanguage(cachedHighlighter, language)

  const html = cachedHighlighter.codeToHtml(code, {
    lang: lang as BundledLanguage,
    theme: theme as BundledTheme,
  })

  return { html, language: lang }
}

/**
 * 同步高亮代码，返回按行 token 结构（适合 React 逐行渲染，流式最优）
 *
 * 相比 highlightCodeSync 返回 HTML 字符串：
 * - 返回结构化 token 数据，由调用方渲染为 React 元素
 * - 配合稳定 key 实现增量 DOM 更新，流式输出只更新变化的行
 * - 返回 null 表示高亮器尚未初始化
 */
export function highlightToTokens(options: HighlightOptions): HighlightTokensResult | null {
  if (!cachedHighlighter) return null

  const { code, language, theme = 'github-dark' } = options
  const lang = resolveLoadedLanguage(cachedHighlighter, language)

  const result = cachedHighlighter.codeToTokens(code, {
    lang: lang as BundledLanguage,
    theme: theme as BundledTheme,
  })

  return {
    lines: result.tokens.map((line) =>
      line.map((token) => ({ content: token.content, color: token.color }))
    ),
    bgColor: result.bg ?? '#24292e',
    fgColor: result.fg ?? '#e1e4e8',
    language: lang,
  }
}
