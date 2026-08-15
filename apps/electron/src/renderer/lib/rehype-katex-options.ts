import rehypeKatex from 'rehype-katex'
import type { Options as RehypeKatexOptions } from 'rehype-katex'
import type { Pluggable } from 'unified'

/** 中文文本落入数学表达式时保留可见内容，但不把 KaTeX 的兼容性提示刷满 Console。 */
export const REHYPE_KATEX_OPTIONS: RehypeKatexOptions = {
  strict: (errorCode) => errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
}

export const REHYPE_KATEX_PLUGINS: Pluggable[] = [[rehypeKatex, REHYPE_KATEX_OPTIONS]]
