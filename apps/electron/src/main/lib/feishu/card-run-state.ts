import type {
  AgentStreamPayload,
  AgentAssistantDelta,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@proma/shared'
import { isPartialSDKMessage } from '../bridge-agent-message-utils'

/**
 * 飞书流式卡片的运行时状态机。
 *
 * 把 AgentStreamPayload（sdk_message + sdk_delta + proma_event）累积成一个结构化的
 * RunState，便于渲染层无时序地把状态转成 CardKit 2.0 JSON。设计参考
 * zara/feishu-claude-code-bridge `src/card/run-state.ts`，但消费的是
 * Proma 的 SDKMessage 形态而非 claude CLI 的 stream-json。
 *
 * 所有 reducer 是纯函数：`reduce(state, payload) → state`。
 */

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolEntry {
  id: string
  name: string
  input: unknown
  status: ToolStatus
  output?: string
  assistantUuid?: string
  contentIndex?: number
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean; assistantUuid?: string; contentIndex?: number }
  | { kind: 'tool'; tool: ToolEntry }

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | null

export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'idle_timeout'

interface PartialAssistantSnapshot {
  blocks: Record<number, { type: 'text' | 'thinking'; content: string }>
}

export interface RunState {
  blocks: Block[]
  reasoning: { content: string; active: boolean }
  /** Pi partial 帧按 assistant UUID 保存的累计快照，用于计算增量。 */
  partialAssistantSnapshots: Record<string, PartialAssistantSnapshot>
  /** Direct Pi Delta 已经在 blocks/reasoning 中消费过的 assistant UUID。 */
  deltaAssistantUuids: Record<string, true>
  /** Direct Pi thinking blocks，按 assistant UUID 与 contentIndex 保存。 */
  deltaAssistantThinking?: Record<string, Record<number, string>>
  footer: FooterStatus
  terminal: Terminal
  errorMsg?: string
  /** idle_timeout 终态下，无响应的分钟数（卡片渲染时拼"N 分钟无响应"）。 */
  idleTimeoutMinutes?: number
  startedAt: number
  /** result 消息携带的元数据，渲染卡片底部 summary 用。 */
  meta: {
    durationMs?: number
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
    model?: string
  }
}

export function createInitialState(): RunState {
  return {
    blocks: [],
    reasoning: { content: '', active: false },
    partialAssistantSnapshots: {},
    deltaAssistantUuids: {},
    footer: 'thinking',
    terminal: 'running',
    startedAt: Date.now(),
    meta: {},
  }
}

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'text' && b.streaming ? { ...b, streaming: false } : b,
  )
}

function appendText(state: RunState, delta: string, assistantUuid?: string, contentIndex?: number): RunState {
  const last = state.blocks[state.blocks.length - 1]
  if (
    last
    && last.kind === 'text'
    && last.streaming
    && (!assistantUuid || last.assistantUuid === assistantUuid)
    && (contentIndex == null || last.contentIndex === contentIndex)
  ) {
    const next: Block = { ...last, content: last.content + delta, assistantUuid, contentIndex }
    return {
      ...state,
      blocks: [...state.blocks.slice(0, -1), next],
      reasoning: { ...state.reasoning, active: false },
      footer: 'streaming',
    }
  }
  return {
    ...state,
    blocks: [...state.blocks, { kind: 'text', content: delta, streaming: true, assistantUuid, contentIndex }],
    reasoning: { ...state.reasoning, active: false },
    footer: 'streaming',
  }
}

function insertAssistantBlock(state: RunState, block: Block, assistantUuid: string, contentIndex: number): RunState {
  const blocks = [...state.blocks]
  let insertAt = blocks.length
  let lastAssistantBlock = -1
  for (const [index, current] of blocks.entries()) {
    const currentUuid = current.kind === 'text' ? current.assistantUuid : current.tool.assistantUuid
    const currentIndex = current.kind === 'text' ? current.contentIndex : current.tool.contentIndex
    if (currentUuid !== assistantUuid) continue
    lastAssistantBlock = index
    if (currentIndex != null && currentIndex > contentIndex) {
      insertAt = index
      break
    }
  }
  if (insertAt === blocks.length && lastAssistantBlock >= 0) insertAt = lastAssistantBlock + 1
  blocks.splice(insertAt, 0, block)
  return { ...state, blocks }
}

function appendAssistantText(state: RunState, assistantUuid: string, contentIndex: number, delta: string): RunState {
  const existing = state.blocks.find((block) =>
    block.kind === 'text'
    && block.assistantUuid === assistantUuid
    && block.contentIndex === contentIndex,
  )
  if (existing?.kind === 'text') {
    return setAssistantTextBlock(state, assistantUuid, contentIndex, existing.content + delta, true)
  }
  return setAssistantTextBlock(state, assistantUuid, contentIndex, delta, true)
}

function setAssistantTextBlock(
  state: RunState,
  assistantUuid: string,
  contentIndex: number,
  content: string,
  streaming: boolean,
): RunState {
  const index = state.blocks.findIndex((block) =>
    block.kind === 'text'
    && block.assistantUuid === assistantUuid
    && block.contentIndex === contentIndex,
  )
  if (index >= 0) {
    const block = state.blocks[index]
    if (!block || block.kind !== 'text') return state
    const blocks = [...state.blocks]
    blocks[index] = { ...block, content, streaming }
    return { ...state, blocks, footer: streaming ? 'streaming' : state.footer }
  }
  return insertAssistantBlock(
    state,
    { kind: 'text', content, streaming, assistantUuid, contentIndex },
    assistantUuid,
    contentIndex,
  )
}

function setAssistantThinking(
  state: RunState,
  assistantUuid: string,
  contentIndex: number,
  content: string,
  active: boolean,
): RunState {
  const thinking = {
    ...(state.deltaAssistantThinking ?? {}),
    [assistantUuid]: {
      ...(state.deltaAssistantThinking?.[assistantUuid] ?? {}),
      [contentIndex]: content,
    },
  }
  const contentForAssistant = Object.entries(thinking[assistantUuid] ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value)
    .join('')
  return {
    ...state,
    deltaAssistantThinking: thinking,
    reasoning: { content: contentForAssistant, active },
    footer: active ? 'thinking' : state.footer,
  }
}

function resetActiveAssistantText(state: RunState, assistantUuid: string): RunState {
  const blocks = state.blocks.filter((block) => {
    const blockUuid = block.kind === 'text' ? block.assistantUuid : block.tool.assistantUuid
    if (blockUuid !== assistantUuid) return true
    if (block.kind === 'text') return false
    return block.tool.status !== 'running'
  })
  if (!state.deltaAssistantThinking?.[assistantUuid]) return { ...state, blocks, reasoning: { content: '', active: false } }
  const { [assistantUuid]: _, ...deltaAssistantThinking } = state.deltaAssistantThinking
  return {
    ...state,
    blocks,
    deltaAssistantThinking,
    reasoning: { content: '', active: false },
  }
}

function appendThinking(state: RunState, delta: string): RunState {
  return {
    ...state,
    reasoning: { content: state.reasoning.content + delta, active: true },
    footer: 'thinking',
  }
}

function startTool(
  state: RunState,
  id: string,
  name: string,
  input: unknown,
  assistantUuid?: string,
  contentIndex?: number,
): RunState {
  const existing = state.blocks.find((block) => block.kind === 'tool' && block.tool.id === id)
  if (existing?.kind === 'tool') {
    return {
      ...state,
      blocks: state.blocks.map((block) => block.kind === 'tool' && block.tool.id === id
        ? {
            ...block,
            tool: {
              ...block.tool,
              name,
              input,
              ...(assistantUuid && { assistantUuid }),
              ...(contentIndex != null && { contentIndex }),
            },
          }
        : block),
      reasoning: { ...state.reasoning, active: false },
      footer: existing.tool.status === 'running' ? 'tool_running' : state.footer,
    }
  }

  const tool: ToolEntry = {
    id,
    name,
    input,
    status: 'running',
    ...(assistantUuid && { assistantUuid }),
    ...(contentIndex != null && { contentIndex }),
  }
  const next: RunState = { ...state, blocks: [...closeStreamingText(state.blocks), { kind: 'tool', tool }] }
  if (assistantUuid && contentIndex != null) {
    return {
      ...insertAssistantBlock(
        { ...state, blocks: closeStreamingText(state.blocks) },
        { kind: 'tool', tool },
        assistantUuid,
        contentIndex,
      ),
      reasoning: { ...state.reasoning, active: false },
      footer: 'tool_running',
    }
  }
  return {
    ...next,
    reasoning: { ...state.reasoning, active: false },
    footer: 'tool_running',
  }
}

function completeTool(state: RunState, id: string, output: string, isError: boolean): RunState {
  const blocks = state.blocks.map((b) => {
    if (b.kind !== 'tool' || b.tool.id !== id) return b
    return {
      ...b,
      tool: { ...b.tool, status: isError ? ('error' as const) : ('done' as const), output },
    }
  })
  return { ...state, blocks }
}

function cumulativeDelta(current: string, previous: string): string {
  return current.startsWith(previous) ? current.slice(previous.length) : current
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c && typeof (c as { text: string }).text === 'string') {
          return (c as { text: string }).text
        }
        try {
          return JSON.stringify(c)
        } catch {
          return String(c)
        }
      })
      .join('\n')
  }
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function reduce(state: RunState, payload: AgentStreamPayload): RunState {
  if (payload.kind === 'sdk_delta') {
    const { uuid, deltas } = payload.delta
    const next = deltas.reduce<RunState>((current, delta) => {
      switch (delta.type) {
        case 'start':
          return resetActiveAssistantText(current, uuid)
        case 'text_start': {
          const blocks = current.blocks.filter((block) => !(
            block.kind === 'text'
            && block.assistantUuid === uuid
            && block.contentIndex === delta.contentIndex
          ))
          return { ...current, blocks, footer: 'streaming' as const }
        }
        case 'text_delta':
          return delta.delta ? appendAssistantText(current, uuid, delta.contentIndex, delta.delta) : current
        case 'text_end':
          return setAssistantTextBlock(current, uuid, delta.contentIndex, delta.content, false)
        case 'thinking_start':
          return setAssistantThinking(current, uuid, delta.contentIndex, '', true)
        case 'thinking_delta': {
          const previous = current.deltaAssistantThinking?.[uuid]?.[delta.contentIndex] ?? ''
          return delta.delta ? setAssistantThinking(current, uuid, delta.contentIndex, previous + delta.delta, true) : current
        }
        case 'thinking_end':
          return setAssistantThinking(current, uuid, delta.contentIndex, delta.content, false)
        case 'toolcall_start':
        case 'toolcall_end': {
          const toolCall = delta.toolCall
          return toolCall
            ? startTool(current, toolCall.id, toolCall.name, toolCall.arguments ?? {}, uuid, delta.contentIndex)
            : current
        }
        default:
          return current
      }
    }, state)
    return {
      ...next,
      deltaAssistantUuids: { ...next.deltaAssistantUuids, [uuid]: true },
    }
  }

  if (payload.kind === 'sdk_message') {
    const msg = payload.message

    if (msg.type === 'assistant') {
      const am = msg as SDKAssistantMessage
      const isPartial = isPartialSDKMessage(msg)
      const assistantId = typeof (msg as { uuid?: unknown }).uuid === 'string'
        ? (msg as { uuid: string }).uuid
        : undefined
      // 没有稳定 UUID 时无法从累计快照推导增量，等待终态帧可避免重复文本。
      if (isPartial && !assistantId) return state

      const previousSnapshot = assistantId ? state.partialAssistantSnapshots[assistantId] : undefined
      const consumedByDelta = assistantId ? state.deltaAssistantUuids[assistantId] === true : false
      const useCumulativeSnapshot = isPartial || previousSnapshot != null
      const partialBlocks: PartialAssistantSnapshot['blocks'] = {}
      let next = state
      if (am.message?.model && !next.meta.model) {
        next = { ...next, meta: { ...next.meta, model: am.message.model } }
      }
      // assistant 消息上若携带顶层 error 字段，直接转为 error 终态
      // （SDK 偶尔会在 assistant 帧带 error，不走 result 路径）
      if (am.error?.message) {
        return markError(state, am.error.message)
      }

      for (const [index, block] of (am.message?.content ?? []).entries()) {
        if (block.type === 'text') {
          const text = (block as { text?: unknown }).text
          if (typeof text === 'string') {
            if (consumedByDelta && assistantId) {
              next = setAssistantTextBlock(next, assistantId, index, text, false)
              continue
            }
            const previous = previousSnapshot?.blocks[index]
            const delta = useCumulativeSnapshot && previous?.type === 'text'
              ? cumulativeDelta(text, previous.content)
              : text
            if (delta) next = appendText(next, delta)
            if (isPartial) partialBlocks[index] = { type: 'text', content: text }
          }
        } else if (block.type === 'thinking') {
          const thinking = (block as { thinking?: unknown }).thinking
          if (typeof thinking === 'string') {
            if (consumedByDelta && assistantId) {
              next = setAssistantThinking(next, assistantId, index, thinking, false)
              continue
            }
            const previous = previousSnapshot?.blocks[index]
            const delta = useCumulativeSnapshot && previous?.type === 'thinking'
              ? cumulativeDelta(thinking, previous.content)
              : thinking
            if (delta) next = appendThinking(next, delta)
            if (isPartial) partialBlocks[index] = { type: 'thinking', content: thinking }
          }
        } else if (block.type === 'tool_use') {
          const tb = block as { id?: unknown; name?: unknown; input?: unknown }
          if (typeof tb.id === 'string' && typeof tb.name === 'string') {
            next = startTool(next, tb.id, tb.name, tb.input, consumedByDelta ? assistantId : undefined, consumedByDelta ? index : undefined)
          }
        }
      }

      if (assistantId && isPartial) {
        return {
          ...next,
          partialAssistantSnapshots: { ...next.partialAssistantSnapshots, [assistantId]: { blocks: partialBlocks } },
        }
      }
      if (assistantId && previousSnapshot) {
        const { [assistantId]: _, ...partialAssistantSnapshots } = next.partialAssistantSnapshots
        const { [assistantId]: _delta, ...deltaAssistantUuids } = next.deltaAssistantUuids
        const deltaAssistantThinking = next.deltaAssistantThinking
          ? Object.fromEntries(Object.entries(next.deltaAssistantThinking).filter(([uuid]) => uuid !== assistantId))
          : next.deltaAssistantThinking
        return { ...next, partialAssistantSnapshots, deltaAssistantUuids, deltaAssistantThinking }
      }
      if (assistantId && consumedByDelta) {
        const { [assistantId]: _, ...deltaAssistantUuids } = next.deltaAssistantUuids
        const deltaAssistantThinking = next.deltaAssistantThinking
          ? Object.fromEntries(Object.entries(next.deltaAssistantThinking).filter(([uuid]) => uuid !== assistantId))
          : next.deltaAssistantThinking
        return { ...next, deltaAssistantUuids, deltaAssistantThinking }
      }
      return next
    }

    if (msg.type === 'user') {
      const um = msg as SDKUserMessage
      let next = state
      for (const block of um.message?.content ?? []) {
        if (block.type === 'tool_result') {
          const trb = block as { tool_use_id?: unknown; content?: unknown; is_error?: unknown }
          if (typeof trb.tool_use_id === 'string') {
            const output = stringifyToolResult(trb.content)
            next = completeTool(next, trb.tool_use_id, output, trb.is_error === true)
          }
        }
      }
      return next
    }

    if (msg.type === 'result') {
      const rm = msg as SDKResultMessage
      const meta = {
        ...state.meta,
        durationMs: Date.now() - state.startedAt,
        inputTokens: rm.usage?.input_tokens,
        outputTokens: rm.usage?.output_tokens,
        costUsd: rm.total_cost_usd,
      }
      // result.subtype 以 'error' 开头视为错误（含 error / error_max_turns /
      // error_max_budget_usd / error_during_execution）
      const isError = typeof rm.subtype === 'string' && rm.subtype.startsWith('error')
      if (isError) {
        const errMsg = rm.errors?.[0] ?? rm.subtype ?? 'Agent 运行出错'
        return {
          ...state,
          blocks: closeStreamingText(state.blocks),
          reasoning: { ...state.reasoning, active: false },
          terminal: 'error',
          footer: null,
          errorMsg: errMsg,
          meta,
        }
      }
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal: 'done',
        footer: null,
        meta,
      }
    }

    return state
  }

  if (payload.kind === 'proma_event') {
    const evt = payload.event
    if (evt.type === 'model_resolved') {
      return { ...state, meta: { ...state.meta, model: evt.model } }
    }
    return state
  }

  return state
}

export function markInterrupted(state: RunState): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'interrupted',
    footer: null,
  }
}

export function markIdleTimeout(state: RunState, minutes: number): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'idle_timeout',
    footer: null,
    idleTimeoutMinutes: minutes,
  }
}

export function markError(state: RunState, message: string): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'error',
    footer: null,
    errorMsg: message,
  }
}

/** 当外部确认 run 已结束但 state 仍是 running 时，兜底收尾。 */
export function finalizeIfRunning(state: RunState): RunState {
  if (state.terminal !== 'running') return state
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'done',
    footer: null,
  }
}
