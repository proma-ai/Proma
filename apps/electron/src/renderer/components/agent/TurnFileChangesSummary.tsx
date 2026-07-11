/**
 * TurnFileChangesSummary — Turn 底部文件改动汇总
 *
 * 在 AssistantTurnRenderer 的 MessageActions 之上，以 chip 横排展示本轮所有
 * 修改类工具调用（Edit / Write / MultiEdit / NotebookEdit）所触及的文件。
 *
 * 子代理（Agent/Task）的修改也会冒泡到此处——因为 SDK 的子代理 assistant
 * 消息同样存在于 turn.turnMessages 中（通过 parent_tool_use_id 关联）。
 *
 * 文件 chip 直接复用 FilePathChip（与 Agent 消息中的渲染完全一致）。
 */

import * as React from 'react'
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKToolUseBlock,
  SDKToolResultBlock,
} from '@proma/shared'
import { FilePathChip } from '@/components/ai-elements/file-path-chip'

const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * 本轮"触碰过"的工具集合（改 + 读）——用于正文内联文件引用的路径补全，比 MUTATING_TOOLS 更宽。
 * Read 的 input.file_path 与 Edit/Write 同构，都是绝对路径，可零解析纳入映射。
 * Grep/Glob 的 input 只有 pattern、命中文件仅存在于 tool_result 中，暂不纳入。
 * 注意：底部"文件改动汇总"chip 仍只用 MUTATING_TOOLS，不受此集合影响。
 */
const TOUCHED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read'])

function getFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === 'NotebookEdit') {
    const fp = input.notebook_path
    return typeof fp === 'string' ? fp : null
  }
  const fp = input.file_path ?? input.filePath ?? input.path
  return typeof fp === 'string' ? fp : null
}

function collectFilePaths(turnMessages: SDKMessage[], tools: Set<string> = MUTATING_TOOLS): string[] {
  const failed = new Set<string>()
  for (const msg of turnMessages) {
    if (msg.type !== 'user') continue
    const blocks = (msg as SDKUserMessage).message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const rb = block as SDKToolResultBlock
      if (rb.is_error === true) failed.add(rb.tool_use_id)
    }
  }

  const seen = new Set<string>()
  const paths: string[] = []
  for (const msg of turnMessages) {
    if (msg.type !== 'assistant') continue
    const blocks = (msg as SDKAssistantMessage).message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue
      const tu = block as SDKToolUseBlock
      if (!tools.has(tu.name)) continue
      if (failed.has(tu.id)) continue

      const filePath = getFilePath(tu.name, tu.input as Record<string, unknown>)
      if (!filePath || seen.has(filePath)) continue
      seen.add(filePath)
      paths.push(filePath)
    }
  }
  return paths
}

/**
 * 构建「文件名 → 绝对路径」映射，供消息正文内联文件引用补全裸文件名使用。
 * 数据源为本轮"触碰过"的文件（TOUCHED_TOOLS：改过 + Read 读过），比底部改动汇总更宽，
 * 覆盖"本轮只读过没改就在正文引用"的高频场景；拿到的都是绝对路径。
 * 同名不同目录的文件无法凭裸文件名区分，直接从映射中剔除，交由既有 basePaths 解析逻辑处理
 * （不比补全前更差）。
 */
export function buildTurnFileNameMap(turnMessages: SDKMessage[]): Map<string, string> {
  const paths = collectFilePaths(turnMessages, TOUCHED_TOOLS)
  const map = new Map<string, string>()
  const conflicted = new Set<string>()
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop() || p
    if (conflicted.has(name)) continue
    const existing = map.get(name)
    if (existing && existing !== p) {
      map.delete(name)
      conflicted.add(name)
      continue
    }
    map.set(name, p)
  }
  return map
}

export interface TurnFileChangesSummaryProps {
  turnMessages: SDKMessage[]
  basePath?: string
}

export function TurnFileChangesSummary({
  turnMessages,
  basePath,
}: TurnFileChangesSummaryProps): React.ReactElement | null {
  const paths = React.useMemo(() => collectFilePaths(turnMessages), [turnMessages])

  if (paths.length === 0) return null

  return (
    <div className="pl-[46px] mt-3">
      <div className="pt-3 border-t-2 border-dashed border-border/60">
        <div className="flex flex-wrap gap-1.5">
          {paths.map((filePath) => (
            <FilePathChip key={filePath} filePath={filePath} basePath={basePath} />
          ))}
        </div>
      </div>
    </div>
  )
}
