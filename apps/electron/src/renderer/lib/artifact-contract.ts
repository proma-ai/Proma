import type { SDKToolUseBlock, ArtifactType } from '@proma/shared'

export const ARTIFACT_TOOL_SERVER = 'artifact'
export const ARTIFACT_CREATE_TOOL = 'create_artifact'
export const ARTIFACT_EDIT_TOOL = 'edit_artifact'
export const ARTIFACT_LOAD_GUIDELINES_TOOL = 'load_artifact_guidelines'
export const MAX_ARTIFACT_CONTENT_CHARS = 120_000
export const DEFAULT_ARTIFACT_TITLE = 'Artifact'

export function isArtifactToolName(name: string): boolean {
  return (
    name === ARTIFACT_CREATE_TOOL ||
    name === ARTIFACT_EDIT_TOOL ||
    name.endsWith(`__${ARTIFACT_CREATE_TOOL}`) ||
    name.endsWith(`__${ARTIFACT_EDIT_TOOL}`)
  )
}

export function isArtifactGuidelineToolName(name: string): boolean {
  return name === ARTIFACT_LOAD_GUIDELINES_TOOL || name.endsWith(`__${ARTIFACT_LOAD_GUIDELINES_TOOL}`)
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function normalizeArtifactType(value: unknown): ArtifactType {
  const valid: ArtifactType[] = ['code', 'html', 'svg', 'mermaid', 'markdown']
  return typeof value === 'string' && valid.includes(value as ArtifactType)
    ? (value as ArtifactType)
    : 'code'
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
      if (char === 'n') value += '\n'
      else if (char === 'r') value += '\r'
      else if (char === 't') value += '\t'
      else if (char === 'b') value += '\b'
      else if (char === 'f') value += '\f'
      else if (char === '/') value += '/'
      else if (char === 'u' && i + 4 < source.length) {
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
    if (char === '"') return value
    value += char
  }
  return value.length > 0 ? value : undefined
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

export function parsePartialArtifactInputJson(partialJson: string): Record<string, unknown> | undefined {
  if (!partialJson.trim()) return undefined

  try {
    const parsed = JSON.parse(partialJson) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to tolerant field extraction
  }

  const extracted: Record<string, unknown> = {}
  assignPartialString(extracted, 'title', partialJson, ['title'])
  assignPartialString(extracted, 'content', partialJson, ['content', 'widget_code'])
  assignPartialString(extracted, 'type', partialJson, ['type'])
  assignPartialString(extracted, 'language', partialJson, ['language'])
  assignPartialString(extracted, 'artifact_id', partialJson, ['artifact_id', 'artifactId'])

  return Object.keys(extracted).length > 0 ? extracted : undefined
}

export type ArtifactCreateParseResult =
  | { ok: true; title: string; type: ArtifactType; content: string; language?: string; description?: string }
  | { ok: false; reason: string; title?: string }

export function parseArtifactCreateInput(
  input: Record<string, unknown> | undefined,
): ArtifactCreateParseResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'create_artifact input must be an object' }
  }

  const content = normalizeString(input.content ?? input.widget_code)
  const title = normalizeString(input.title) ?? DEFAULT_ARTIFACT_TITLE
  if (!content) {
    return { ok: false, reason: 'create_artifact input is missing content', title }
  }
  if (content.length > MAX_ARTIFACT_CONTENT_CHARS) {
    return { ok: false, reason: `content exceeds ${MAX_ARTIFACT_CONTENT_CHARS} characters`, title }
  }

  return {
    ok: true,
    title,
    type: normalizeArtifactType(input.type),
    content,
    language: normalizeString(input.language),
    description: normalizeString(input.description),
  }
}

export type ArtifactEditParseResult =
  | { ok: true; artifactId: string; title?: string; content?: string; language?: string }
  | { ok: false; reason: string }

export function parseArtifactEditInput(
  input: Record<string, unknown> | undefined,
): ArtifactEditParseResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'edit_artifact input must be an object' }
  }

  const artifactId = normalizeString(input.artifact_id ?? input.artifactId)
  if (!artifactId) {
    return { ok: false, reason: 'edit_artifact input is missing artifact_id' }
  }

  const content = normalizeString(input.content)
  if (content && content.length > MAX_ARTIFACT_CONTENT_CHARS) {
    return { ok: false, reason: `content exceeds ${MAX_ARTIFACT_CONTENT_CHARS} characters` }
  }

  return {
    ok: true,
    artifactId,
    title: normalizeString(input.title),
    content,
    language: normalizeString(input.language),
  }
}

export function parseArtifactToolBlock(
  block: SDKToolUseBlock,
): { toolName: string; input: Record<string, unknown> } | null {
  if (block.type !== 'tool_use') return null
  const name = typeof block.name === 'string' ? block.name : ''
  if (!isArtifactToolName(name)) return null
  return { toolName: name, input: (block.input as Record<string, unknown>) ?? {} }
}
