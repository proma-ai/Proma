import type { PromaEvent, SDKAssistantMessage, SDKMessage } from '@proma/shared'
import { isGenerativeUiToolName } from './generative-ui-agent-tools'

interface TrackedWidgetBlock {
  toolUseId: string
  toolName: string
  partialJson: string
  parentToolUseId?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getEventIndex(event: Record<string, unknown>): number | undefined {
  return numberValue(event.index)
}

function getParentToolUseId(message: SDKMessage): string | null | undefined {
  const value = (message as Record<string, unknown>).parent_tool_use_id
  return value === null || typeof value === 'string' ? value : undefined
}

function getToolUseName(block: Record<string, unknown>): string | undefined {
  const name = stringValue(block.name)
  if (!name) return undefined
  const serverName = stringValue(block.server_name)
  if (serverName === 'generative-ui') return name
  if (isGenerativeUiToolName(name)) return name
  return undefined
}

function isShowWidgetBlock(block: unknown): block is Record<string, unknown> {
  if (!isRecord(block)) return false
  const type = stringValue(block.type)
  if (type !== 'tool_use' && type !== 'mcp_tool_use') return false
  const name = getToolUseName(block)
  return typeof name === 'string' && isGenerativeUiToolName(name)
}

function createStreamEvent(block: TrackedWidgetBlock): PromaEvent {
  return {
    type: 'generative_ui_widget_stream',
    toolUseId: block.toolUseId,
    toolName: block.toolName,
    partialJson: block.partialJson,
    parentToolUseId: block.parentToolUseId,
    updatedAt: Date.now(),
  }
}

export class GenerativeUiPartialWidgetTracker {
  private readonly blocks = new Map<number, TrackedWidgetBlock>()

  handleMessage(message: SDKMessage): PromaEvent[] {
    if ((message as Record<string, unknown>).type !== 'stream_event') return []

    const event = (message as { event?: unknown }).event
    if (!isRecord(event)) return []

    const eventType = stringValue(event.type)
    const index = getEventIndex(event)
    if (index == null) return []

    if (eventType === 'content_block_start') {
      const block = event.content_block
      if (!isShowWidgetBlock(block)) return []
      const toolUseId = stringValue(block.id)
      const toolName = getToolUseName(block)
      if (!toolUseId || !toolName) return []
      this.blocks.set(index, {
        toolUseId,
        toolName,
        partialJson: '',
        parentToolUseId: getParentToolUseId(message),
      })
      return []
    }

    if (eventType === 'content_block_delta') {
      const tracked = this.blocks.get(index)
      if (!tracked) return []
      const delta = event.delta
      if (!isRecord(delta) || stringValue(delta.type) !== 'input_json_delta') return []
      const partial = stringValue(delta.partial_json)
      if (!partial) return []
      tracked.partialJson += partial
      return [createStreamEvent(tracked)]
    }

    if (eventType === 'content_block_stop') {
      this.blocks.delete(index)
    }

    return []
  }

  buildFinalEvents(message: SDKMessage): PromaEvent[] {
    if (message.type !== 'assistant') return []
    const assistant = message as SDKAssistantMessage
    const events: PromaEvent[] = []
    for (const block of assistant.message.content) {
      if (!isShowWidgetBlock(block)) continue
      const toolUseId = stringValue(block.id)
      const toolName = getToolUseName(block)
      if (!toolUseId || !toolName) continue
      events.push({
        type: 'generative_ui_widget_stream_end',
        toolUseId,
        toolName,
        input: isRecord(block.input) ? block.input : undefined,
        parentToolUseId: getParentToolUseId(message),
        updatedAt: Date.now(),
      })
    }
    return events
  }
}
