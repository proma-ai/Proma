import type { SDKToolUseBlock } from '@proma/shared'

export const GENERATIVE_UI_TOOL_SERVER = 'generative-ui'
export const GENERATIVE_UI_SHOW_WIDGET_TOOL = 'show_widget'
export const GENERATIVE_UI_LOAD_GUIDELINES_TOOL = 'load_widget_guidelines'
export const MAX_GENERATIVE_WIDGET_CODE_CHARS = 120_000
export const DEFAULT_GENERATIVE_WIDGET_TITLE = '生成式 UI'

export interface GenerativeWidgetOwner {
  sessionId?: string
  workspaceId?: string
  messageId?: string
  toolUseId?: string
  runId?: string
  pinnedTo?: 'report' | 'dashboard'
}

export interface GenerativeWidgetArtifact {
  id: string
  title: string
  widgetCode: string
  description?: string
  initialHeight?: number
  layout?: 'compact' | 'wide' | 'full'
  preferredWidth?: number
  interactionMode: 'render-only' | 'interactive'
  owner: GenerativeWidgetOwner
}

export type GenerativeWidgetParseResult =
  | { ok: true; artifact: GenerativeWidgetArtifact }
  | { ok: false; reason: string; title?: string }

export function isGenerativeUiToolName(name: string): boolean {
  return name === GENERATIVE_UI_SHOW_WIDGET_TOOL || name.endsWith(`__${GENERATIVE_UI_SHOW_WIDGET_TOOL}`)
}

export function isGenerativeUiGuidelineToolName(name: string): boolean {
  return name === GENERATIVE_UI_LOAD_GUIDELINES_TOOL || name.endsWith(`__${GENERATIVE_UI_LOAD_GUIDELINES_TOOL}`)
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function normalizeInitialHeight(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(2000, Math.max(120, Math.round(value)))
}

function normalizePreferredWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(1600, Math.max(240, Math.round(value)))
}

function normalizeLayout(value: unknown): 'compact' | 'wide' | 'full' | undefined {
  return value === 'compact' || value === 'wide' || value === 'full' ? value : undefined
}

function normalizePinTarget(value: unknown): 'report' | 'dashboard' | undefined {
  return value === 'report' || value === 'dashboard' ? value : undefined
}

function normalizeInteractionMode(value: unknown): 'render-only' | 'interactive' {
  return value === 'render-only' ? 'render-only' : 'interactive'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readPartialJsonStringValue(source: string, key: string): string | undefined {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, 'g')
  const match = pattern.exec(source)
  if (!match) return undefined

  let value = ''
  let escaped = false
  const start = match.index + match[0].length
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (escaped) {
      escaped = false
      if (char === 'n') {
        value += '\n'
      } else if (char === 'r') {
        value += '\r'
      } else if (char === 't') {
        value += '\t'
      } else if (char === 'b') {
        value += '\b'
      } else if (char === 'f') {
        value += '\f'
      } else if (char === 'u' && i + 4 < source.length) {
        const hex = source.slice(i + 1, i + 5)
        if (/^[0-9a-f]{4}$/i.test(hex)) {
          value += String.fromCharCode(Number.parseInt(hex, 16))
          i += 4
        } else {
          value += char
        }
      } else {
        value += char
      }
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      return value
    }
    value += char
  }
  return value.length > 0 ? value : undefined
}

function readPartialJsonNumberValue(source: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)
    const match = pattern.exec(source)
    if (!match) continue
    const value = Number(match[1])
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function assignPartialString(
  target: Record<string, unknown>,
  outputKey: string,
  source: string,
  keys: string[],
): void {
  for (const key of keys) {
    const value = readPartialJsonStringValue(source, key)
    if (value !== undefined) {
      target[outputKey] = value
      return
    }
  }
}

export function parsePartialGenerativeWidgetInputJson(partialJson: string): Record<string, unknown> | undefined {
  if (!partialJson.trim()) return undefined

  try {
    const parsed = JSON.parse(partialJson) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to tolerant field extraction for in-flight JSON fragments.
  }

  const extracted: Record<string, unknown> = {}
  assignPartialString(extracted, 'title', partialJson, ['title'])
  assignPartialString(extracted, 'description', partialJson, ['description'])
  assignPartialString(extracted, 'widget_code', partialJson, ['widget_code', 'widgetCode'])
  assignPartialString(extracted, 'layout', partialJson, ['layout'])
  assignPartialString(extracted, 'interaction_mode', partialJson, ['interaction_mode', 'interactionMode'])

  const initialHeight = readPartialJsonNumberValue(partialJson, ['initial_height', 'initialHeight'])
  if (initialHeight !== undefined) extracted.initial_height = initialHeight
  const preferredWidth = readPartialJsonNumberValue(partialJson, ['preferred_width', 'preferredWidth'])
  if (preferredWidth !== undefined) extracted.preferred_width = preferredWidth

  return Object.keys(extracted).length > 0 ? extracted : undefined
}

function stableArtifactId(input: {
  toolUseId?: string
  title: string
  widgetCode: string
}): string {
  if (input.toolUseId) return `widget-${input.toolUseId}`
  let hash = 5381
  const source = `${input.title}\n${input.widgetCode.slice(0, 2048)}`
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) + hash) ^ source.charCodeAt(i)
  }
  return `widget-${(hash >>> 0).toString(36)}`
}

export function parseGenerativeWidgetInput(
  input: Record<string, unknown> | undefined,
  owner: GenerativeWidgetOwner = {},
): GenerativeWidgetParseResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'show_widget input must be an object' }
  }

  const widgetCode = normalizeString(input.widget_code ?? input.widgetCode)
  const title = normalizeString(input.title) ?? DEFAULT_GENERATIVE_WIDGET_TITLE
  if (!widgetCode) {
    return { ok: false, reason: 'show_widget input is missing widget_code', title }
  }
  if (widgetCode.length > MAX_GENERATIVE_WIDGET_CODE_CHARS) {
    return {
      ok: false,
      reason: `widget_code exceeds ${MAX_GENERATIVE_WIDGET_CODE_CHARS} characters`,
      title,
    }
  }

  const pinnedTo = normalizePinTarget(input.pin_target ?? input.pinTarget) ?? owner.pinnedTo
  const artifact: GenerativeWidgetArtifact = {
    id: stableArtifactId({ toolUseId: owner.toolUseId, title, widgetCode }),
    title,
    widgetCode,
    description: normalizeString(input.description),
    initialHeight: normalizeInitialHeight(input.initial_height ?? input.initialHeight),
    layout: normalizeLayout(input.layout),
    preferredWidth: normalizePreferredWidth(input.preferred_width ?? input.preferredWidth),
    interactionMode: normalizeInteractionMode(input.interaction_mode ?? input.interactionMode),
    owner: pinnedTo ? { ...owner, pinnedTo } : owner,
  }

  return { ok: true, artifact }
}

export function parseGenerativeWidgetToolBlock(
  block: SDKToolUseBlock,
  owner: Omit<GenerativeWidgetOwner, 'toolUseId'> = {},
): GenerativeWidgetParseResult {
  return parseGenerativeWidgetInput(block.input, {
    ...owner,
    toolUseId: block.id,
  })
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function parseGenerativeWidgetOwnerFromToolResult(resultText: string | undefined): GenerativeWidgetOwner {
  if (!resultText) return {}
  try {
    const payload = JSON.parse(resultText) as unknown
    if (!payload || typeof payload !== 'object') return {}
    const record = payload as Record<string, unknown>
    if (record.type !== 'generative_ui_widget') return {}
    const artifact = record.artifact
    if (!artifact || typeof artifact !== 'object') return {}
    const owner = (artifact as Record<string, unknown>).owner
    if (!owner || typeof owner !== 'object') return {}
    const ownerRecord = owner as Record<string, unknown>
    const artifactRecord = artifact as Record<string, unknown>
    return {
      sessionId: stringValue(ownerRecord, 'sessionId'),
      workspaceId: stringValue(ownerRecord, 'workspaceId'),
      runId: stringValue(ownerRecord, 'runId'),
      messageId: stringValue(ownerRecord, 'messageId'),
      toolUseId: stringValue(ownerRecord, 'toolUseId'),
      pinnedTo: normalizePinTarget(ownerRecord.pinnedTo ?? artifactRecord.pinTarget),
    }
  } catch {
    return {}
  }
}
