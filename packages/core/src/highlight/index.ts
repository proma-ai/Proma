/**
 * 语法高亮模块
 *
 * 基于 Shiki 的代码语法高亮服务，支持懒加载和按需加载语言。
 */

export {
  getDisplayName,
  highlightCode,
  highlightCodeSync,
  highlightToTokens,
  isHighlighterReady,
  onHighlighterReady,
  type HighlightOptions,
  type HighlightResult,
  type HighlightToken,
  type HighlightTokensResult,
} from './shiki-service.ts'
export { detectLanguage } from './language-detector.ts'
