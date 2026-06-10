import type { PromaEvent, SDKAssistantMessage, SDKMessage } from '@proma/shared'
import {
  DEFAULT_GENERATIVE_WIDGET_TITLE,
  isGenerativeUiToolName,
  parsePartialGenerativeWidgetInputJson,
} from './generative-ui-contract'

export interface LiveGenerativeWidgetPreview {
  toolUseId: string
  toolName?: string
  title: string
  description?: string
  widgetCode: string
  initialHeight?: number
  layout?: 'compact' | 'wide' | 'full'
  preferredWidth?: number
  interactionMode: 'render-only' | 'interactive'
  isStreaming: boolean
  finalized?: boolean
  updatedAt: number
}

type PartialWidgetEvent = Extract<PromaEvent, { type: 'generative_ui_widget_stream' }>
type FinalWidgetEvent = Extract<PromaEvent, { type: 'generative_ui_widget_stream_end' }>

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function rawStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function layoutValue(value: unknown): 'compact' | 'wide' | 'full' | undefined {
  return value === 'compact' || value === 'wide' || value === 'full' ? value : undefined
}

function interactionModeValue(value: unknown): 'render-only' | 'interactive' {
  return value === 'render-only' ? 'render-only' : 'interactive'
}

function previewFromInput(
  toolUseId: string,
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
  updatedAt: number,
  isStreaming: boolean,
): LiveGenerativeWidgetPreview | undefined {
  if (!input) return undefined
  const widgetCode = rawStringValue(input.widget_code ?? input.widgetCode)
  if (!widgetCode) return undefined
  return {
    toolUseId,
    toolName,
    title: stringValue(input.title) ?? DEFAULT_GENERATIVE_WIDGET_TITLE,
    description: stringValue(input.description),
    widgetCode,
    initialHeight: numberValue(input.initial_height ?? input.initialHeight),
    layout: layoutValue(input.layout),
    preferredWidth: numberValue(input.preferred_width ?? input.preferredWidth),
    interactionMode: interactionModeValue(input.interaction_mode ?? input.interactionMode),
    isStreaming,
    finalized: !isStreaming,
    updatedAt,
  }
}

export function buildLiveGenerativeWidgetPreviewFromStreamEvent(
  event: PartialWidgetEvent,
): LiveGenerativeWidgetPreview | undefined {
  const input = parsePartialGenerativeWidgetInputJson(event.partialJson)
  return previewFromInput(event.toolUseId, event.toolName, input, event.updatedAt, true)
}

export function buildLiveGenerativeWidgetPreviewFromFinalEvent(
  event: FinalWidgetEvent,
): LiveGenerativeWidgetPreview | undefined {
  return previewFromInput(event.toolUseId, event.toolName, event.input, event.updatedAt, false)
}

export function liveGenerativeWidgetPreviewToInput(
  preview: LiveGenerativeWidgetPreview,
): Record<string, unknown> {
  return {
    title: preview.title,
    description: preview.description,
    widget_code: preview.widgetCode,
    initial_height: preview.initialHeight,
    layout: preview.layout,
    preferred_width: preview.preferredWidth,
    interaction_mode: preview.interactionMode,
  }
}

export function getGenerativeUiToolUseIds(message: SDKMessage): string[] {
  if (message.type !== 'assistant') return []
  const assistant = message as SDKAssistantMessage
  return assistant.message.content
    .filter((block) =>
      block.type === 'tool_use' &&
      'name' in block &&
      typeof block.name === 'string' &&
      isGenerativeUiToolName(block.name) &&
      typeof block.id === 'string'
    )
    .map((block) => (block as { id: string }).id)
}

export function stripPreviewedGenerativeWidgetBlocks(
  message: SDKMessage,
  previewedToolUseIds: Set<string>,
): SDKMessage | null {
  if (previewedToolUseIds.size === 0 || message.type !== 'assistant') return message

  const assistant = message as SDKAssistantMessage
  const nextContent = assistant.message.content.filter((block) => {
    if (
      block.type === 'tool_use' &&
      'name' in block &&
      typeof block.name === 'string' &&
      isGenerativeUiToolName(block.name) &&
      typeof block.id === 'string'
    ) {
      return !previewedToolUseIds.has(block.id)
    }
    return true
  })

  if (nextContent.length === assistant.message.content.length) return message
  if (nextContent.length === 0) return null
  return {
    ...assistant,
    message: {
      ...assistant.message,
      content: nextContent,
    },
  } as SDKMessage
}
