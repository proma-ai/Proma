/**
 * Markdown 顶层分块工具 — 流式渲染的分块记忆化基础
 *
 * 把一段 Markdown 按"空行 + 非围栏代码"边界切成顶层 block 列表。
 * MessageResponse 据此为每个 block 单独走 react-markdown 管线并做 React.memo：
 * 流式输出时只有最后一个仍在增长的 block 需要重新解析，前面的 block 全部命中 memo，
 * 将每帧解析成本从 O(全文) 降到 O(最后一段)。
 *
 * 正确性策略（宁可少切、不可切错）：
 * - 围栏代码块（``` / ~~~，含内部空行）永远不切分
 * - 缩进续行（列表项内的续段/嵌套内容）并回上一个 block，避免 4 空格缩进被误判为代码块
 * - 相邻两个 block 都是列表项时合并，保留 loose list 语义
 * - 出现链接引用定义 / 脚注定义（跨 block 依赖）时整体退回单 block，保证渲染结果不变
 */

/** 列表项行：-、*、+ 或 1. / 1) 前缀（≤3 空格缩进） */
const LIST_ITEM_RE = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/

/** 围栏开启行：≤3 空格缩进 + ``` 或 ~~~（3 个及以上） */
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

/** 围栏关闭行：≤3 空格缩进 + 纯围栏字符 */
const FENCE_CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/

/** 链接引用定义（[label]: url）或脚注定义（[^id]:）——跨 block 依赖，禁用分块 */
const CROSS_BLOCK_REFERENCE_RE = /^\s{0,3}\[(?:\^[^\]]*|[^\]]+)\]:/m

/**
 * 判断后一个 block 是否应并回前一个 block。
 * - 缩进开头：列表/引用内部的续行内容，切开会改变解析结果（缩进代码块误判）
 * - 前后都是列表项：属于同一个 loose list，切开会拆散列表
 */
function shouldMergeWithPrevious(previousBlock: string, nextBlock: string): boolean {
  if (/^\s/.test(nextBlock)) return true
  if (LIST_ITEM_RE.test(nextBlock)) {
    const previousLines = previousBlock.split('\n')
    const lastLine = previousLines[previousLines.length - 1] ?? ''
    return LIST_ITEM_RE.test(previousLines[0] ?? '') || LIST_ITEM_RE.test(lastLine) || /^\s/.test(lastLine)
  }
  return false
}

/**
 * 按顶层边界切分 Markdown。
 *
 * 返回的 block 之间隐含空行分隔；单独渲染每个 block 与整体渲染等价
 * （除已通过整体回退保护的跨 block 引用外）。
 */
export function splitMarkdownIntoBlocks(markdown: string): string[] {
  if (!markdown) return []

  // 跨 block 引用定义存在时放弃分块，保证正确性（LLM 输出中极少见）
  if (CROSS_BLOCK_REFERENCE_RE.test(markdown)) return [markdown]

  const lines = markdown.split('\n')
  const rawBlocks: string[] = []
  let current: string[] = []
  let fenceChar: string | null = null
  let fenceLength = 0

  const flush = (): void => {
    while (current.length > 0 && current[current.length - 1]!.trim() === '') current.pop()
    if (current.length > 0) rawBlocks.push(current.join('\n'))
    current = []
  }

  for (const line of lines) {
    if (fenceChar) {
      current.push(line)
      const closeMatch = FENCE_CLOSE_RE.exec(line)
      if (closeMatch && closeMatch[1]![0] === fenceChar && closeMatch[1]!.length >= fenceLength) {
        fenceChar = null
        fenceLength = 0
      }
      continue
    }

    const openMatch = FENCE_OPEN_RE.exec(line)
    if (openMatch) {
      const marker = openMatch[1]!
      const info = openMatch[2] ?? ''
      // CommonMark：反引号围栏的 info string 不允许再含反引号（行内代码 ``` 场景）
      if (!(marker[0] === '`' && info.includes('`'))) {
        fenceChar = marker[0]!
        fenceLength = marker.length
        current.push(line)
        continue
      }
    }

    if (line.trim() === '') {
      // 空行内不切分空 block；连续空行只产生一次边界
      flush()
    } else {
      current.push(line)
    }
  }
  flush()

  // 合并不能独立渲染的相邻 block（缩进续行 / loose list）
  const blocks: string[] = []
  for (const block of rawBlocks) {
    const previous = blocks[blocks.length - 1]
    if (previous !== undefined && shouldMergeWithPrevious(previous, block)) {
      blocks[blocks.length - 1] = `${previous}\n\n${block}`
    } else {
      blocks.push(block)
    }
  }

  return blocks
}
