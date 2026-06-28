import type { SDKContentBlock, SDKTextBlock } from '@proma/shared'

const THINK_OPEN_TAG = '<think>'
const THINK_CLOSE_TAG = '</think>'

function appendTextBlock(blocks: SDKContentBlock[], text: string): void {
  if (!text.trim()) return
  blocks.push({ type: 'text', text })
}

function appendThinkingBlock(blocks: SDKContentBlock[], thinking: string): void {
  const content = thinking.trim()
  if (!content) return
  blocks.push({ type: 'thinking', thinking: content })
}

/**
 * 兼容部分模型把思考内容包在 <think> 标签里的返回格式。
 * 未闭合的 <think> 在流式阶段按思考块处理，等闭合标签到达后会自然拆出后续正文。
 */
export function parseThinkTagsFromText(text: string): SDKContentBlock[] {
  const lowerText = text.toLowerCase()
  const blocks: SDKContentBlock[] = []
  let cursor = 0

  while (cursor < text.length) {
    const openIndex = lowerText.indexOf(THINK_OPEN_TAG, cursor)
    if (openIndex === -1) {
      appendTextBlock(blocks, text.slice(cursor))
      break
    }

    appendTextBlock(blocks, text.slice(cursor, openIndex))

    const contentStart = openIndex + THINK_OPEN_TAG.length
    const closeIndex = lowerText.indexOf(THINK_CLOSE_TAG, contentStart)
    if (closeIndex === -1) {
      appendThinkingBlock(blocks, text.slice(contentStart))
      break
    }

    appendThinkingBlock(blocks, text.slice(contentStart, closeIndex))
    cursor = closeIndex + THINK_CLOSE_TAG.length
  }

  return blocks
}

export function splitThinkTagsInTextBlock(block: SDKTextBlock): SDKContentBlock[] {
  if (!block.text.toLowerCase().includes(THINK_OPEN_TAG)) return [block]
  return parseThinkTagsFromText(block.text)
}

export function normalizeThinkTagsInContentBlocks(blocks: SDKContentBlock[]): SDKContentBlock[] {
  const normalized: SDKContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      normalized.push(...splitThinkTagsInTextBlock(block as SDKTextBlock))
    } else {
      normalized.push(block)
    }
  }
  return normalized
}
