/**
 * @proma/session-core — Proma 会话读取 / 快照去重 / 转录 / 渲染的 headless 核心。
 *
 * 唯一真源：Electron 主进程、proma CLI、未来的 query 型接口共用本包，
 * 避免在仓库外侧重抄一份会随存储格式漂移的解析器。
 *
 * 本主入口（'.'）**全部为纯函数，浏览器安全**，可被 Electron 渲染层直接 import。
 * 涉及文件 IO（node:fs）的 readSessionMessages 在子入口 '@proma/session-core/node'，
 * 仅供 Node 侧（proma CLI / 主进程）使用，避免 Vite 把 node:fs 打进渲染层 bundle。
 */

// 解析与格式归一（纯函数，无文件 IO）
export {
  readSessionMessagesFromString,
  convertLegacyMessage,
} from './read'

// Turn 分组（快照合并去重的唯一真源）
export {
  groupIntoTurns,
  getGroupPreview,
  extractUserText,
  extractMeta,
  isUserInputMessage,
  stripScheduledRunMarker,
  type MessageGroup,
  type AssistantTurn,
  type MessageMeta,
} from './group'

// <think> 标签归一
export {
  normalizeThinkTagsInContentBlocks,
  parseThinkTagsFromText,
  splitThinkTagsInTextBlock,
} from './thinking-tags'

// 转录（稳定下标 + assistant 多快照去重 + 工具摘要折叠）
export {
  toTranscript,
  summarizeToolInput,
  collapseToolSummaries,
  type TranscriptTurn,
  type TurnRole,
} from './transcript'

// 渐进式读取原语
export { outline, formatOutlineLine, type OutlineEntry } from './outline'
export { searchTurns, type SearchHit, type SearchOptions } from './search'
export { selectTurns, type SelectOptions } from './select'
export { renderTranscriptMarkdown, type RenderMarkdownOptions } from './render-markdown'
export { estimateTokens } from './tokens'
