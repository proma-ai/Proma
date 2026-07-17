/**
 * Agent runtime 行为守卫。
 *
 * 这层只表达 Proma 自己承诺的语义，不绑定某个 SDK 的入口调用方式：
 * - 最大轮次：在 turn 完成后、下一轮 prompt / steer / follow-up 前停止。
 * - 最大预算：在 runtime 返回已知费用后，停止后续工具批次、prompt 与队列消息。
 * - 结构化输出：Pi 当前没有 provider-native schema response format，Proma 用提示词约束
 *   加最终结果校验补齐兼容行为。
 */

import type { AgentMessage, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { JsonSchemaOutputFormat, SDKResultMessage } from '@proma/shared'

export type RuntimeGuardStopReason = 'max_turns' | 'max_budget_usd' | 'output_validation_failed'

export interface RuntimeGuardResultOverride {
  subtype: SDKResultMessage['subtype']
  terminalReason: RuntimeGuardStopReason
  errors: string[]
}

export interface AgentRuntimeGuard {
  recordMessage(message: AgentMessage): void
  shouldStopBeforeNextTurn(): boolean
  applyToolResult<TDetails>(result: AgentToolResult<TDetails>): AgentToolResult<TDetails>
  getLimitResultOverride(): RuntimeGuardResultOverride | undefined
  getResultOverride(messages: AgentMessage[]): RuntimeGuardResultOverride | undefined
}

export interface AgentRuntimeGuardOptions {
  maxTurns?: number
  maxBudgetUsd?: number
  outputFormat?: JsonSchemaOutputFormat
}

interface ValidationFailure {
  path: string
  message: string
}

interface GuardState {
  assistantTurns: number
  knownCostUsd: number
  maxTurnsReached: boolean
  budgetReached: boolean
  stopReason?: RuntimeGuardLimitStopReason
}

type RuntimeGuardLimitStopReason = Exclude<RuntimeGuardStopReason, 'output_validation_failed'>

const JSON_CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i

export function createAgentRuntimeGuard(options: AgentRuntimeGuardOptions): AgentRuntimeGuard {
  const state: GuardState = {
    assistantTurns: 0,
    knownCostUsd: 0,
    maxTurnsReached: false,
    budgetReached: false,
  }
  const maxTurns = normalizePositiveNumber(options.maxTurns)
  const maxBudgetUsd = normalizePositiveNumber(options.maxBudgetUsd)
  const getLimitResultOverride = (): RuntimeGuardResultOverride | undefined => {
    const reason = markLimitStopReason(state, maxTurns, maxBudgetUsd)
    return reason ? createLimitResultOverride(reason, maxTurns, maxBudgetUsd) : undefined
  }

  return {
    recordMessage(message) {
      if (!isAssistantLikeMessage(message)) return
      state.assistantTurns += 1
      if (maxTurns != null && state.assistantTurns >= maxTurns) {
        state.maxTurnsReached = true
      }

      const cost = extractMessageCostUsd(message)
      if (cost != null) {
        state.knownCostUsd += cost
        if (maxBudgetUsd != null && state.knownCostUsd >= maxBudgetUsd) {
          state.budgetReached = true
        }
      }
    },

    shouldStopBeforeNextTurn() {
      return markLimitStopReason(state, maxTurns, maxBudgetUsd) != null
    },

    applyToolResult(result) {
      if (markLimitStopReason(state, maxTurns, maxBudgetUsd)) {
        return { ...result, terminate: true }
      }
      return result
    },

    getLimitResultOverride() {
      return getLimitResultOverride()
    },

    getResultOverride(messages) {
      const limitOverride = getLimitResultOverride()
      if (limitOverride) return limitOverride

      if (!options.outputFormat) return undefined

      const validation = validateFinalOutput(messages, options.outputFormat)
      if (validation.length === 0) return undefined
      return {
        subtype: 'error_during_execution',
        terminalReason: 'output_validation_failed',
        errors: validation.map((failure) => `${failure.path}: ${failure.message}`),
      }
    },
  }
}

function markLimitStopReason(
  state: GuardState,
  maxTurns: number | undefined,
  maxBudgetUsd: number | undefined,
): RuntimeGuardLimitStopReason | undefined {
  if (state.stopReason) return state.stopReason
  if (state.budgetReached && maxBudgetUsd != null) {
    state.stopReason = 'max_budget_usd'
    return state.stopReason
  }
  if (state.maxTurnsReached && maxTurns != null) {
    state.stopReason = 'max_turns'
    return state.stopReason
  }
  return undefined
}

function createLimitResultOverride(
  reason: RuntimeGuardLimitStopReason,
  maxTurns: number | undefined,
  maxBudgetUsd: number | undefined,
): RuntimeGuardResultOverride {
  if (reason === 'max_budget_usd') {
    return {
      subtype: 'error_max_budget_usd',
      terminalReason: 'max_budget_usd',
      errors: [`已达到 Agent 预算上限（$${formatUsd(maxBudgetUsd)}），已停止后续 prompt、工具调用与排队消息。`],
    }
  }

  return {
    subtype: 'error_max_turns',
    terminalReason: 'max_turns',
    errors: [`已达到 Agent 最大轮次限制（${maxTurns}），已停止后续 prompt、工具调用与排队消息。`],
  }
}

export function appendOutputFormatInstruction(prompt: string, outputFormat?: JsonSchemaOutputFormat): string {
  if (!outputFormat) return prompt

  const schemaName = outputFormat.name ? `「${outputFormat.name}」` : '指定 JSON Schema'
  const description = outputFormat.description ? `\n说明：${outputFormat.description}` : ''
  return `${prompt}

<output_format>
你必须只输出一个 JSON 值，不要输出 Markdown 代码块、前后解释或额外文本。
该 JSON 必须符合 ${schemaName}：${description}
${JSON.stringify(outputFormat.schema, null, 2)}
</output_format>`
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function formatUsd(value: number | undefined): string {
  return value == null ? '0' : value.toFixed(value >= 1 ? 2 : 4)
}

function isAssistantLikeMessage(message: unknown): message is AgentMessage & { role: 'assistant' } {
  return Boolean(message && typeof message === 'object' && 'role' in message && message.role === 'assistant')
}

function extractMessageCostUsd(message: AgentMessage): number | undefined {
  if (!isRecord(message) || !isRecord(message.usage) || !isRecord(message.usage.cost)) return undefined
  const total = message.usage.cost.total
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : undefined
}

function validateFinalOutput(messages: AgentMessage[], outputFormat: JsonSchemaOutputFormat): ValidationFailure[] {
  const text = extractLastAssistantText(messages).trim()
  if (!text) {
    return [{ path: '$', message: '未找到可校验的最终文本输出' }]
  }

  const parsed = parseJsonOutput(text)
  if (!parsed.ok) {
    return [{ path: '$', message: parsed.error }]
  }

  return validateSchemaValue(parsed.value, outputFormat.schema, '$')
}

function extractLastAssistantText(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const text = message.content.map((block) => {
      if (!isRecord(block) || block.type !== 'text') return ''
      return typeof block.text === 'string' ? block.text : ''
    }).join('')
    if (text.trim()) return text
  }
  return ''
}

function parseJsonOutput(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const normalized = stripJsonCodeFence(text.trim())
  const direct = tryParseJson(normalized)
  if (direct.ok) return direct

  const slice = extractLikelyJsonSlice(normalized)
  if (slice) {
    const sliced = tryParseJson(slice)
    if (sliced.ok) return sliced
  }

  return { ok: false, error: direct.error }
}

function stripJsonCodeFence(text: string): string {
  const match = text.match(JSON_CODE_FENCE_PATTERN)
  return match?.[1]?.trim() ?? text
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `不是有效 JSON：${error.message}` : '不是有效 JSON' }
  }
}

function extractLikelyJsonSlice(text: string): string | undefined {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const starts = [objectStart, arrayStart].filter((index) => index >= 0)
  if (starts.length === 0) return undefined

  const start = Math.min(...starts)
  const endChar = text[start] === '{' ? '}' : ']'
  const end = text.lastIndexOf(endChar)
  return end > start ? text.slice(start, end + 1) : undefined
}

function validateSchemaValue(value: unknown, schema: Record<string, unknown>, path: string): ValidationFailure[] {
  const failures: ValidationFailure[] = []
  validateType(value, schema, path, failures)
  validateConst(value, schema, path, failures)
  validateEnum(value, schema, path, failures)
  validateStringConstraints(value, schema, path, failures)
  validateNumberConstraints(value, schema, path, failures)
  validateObject(value, schema, path, failures)
  validateArray(value, schema, path, failures)
  validateCombinators(value, schema, path, failures)
  return failures
}

function validateConst(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  if (!('const' in schema)) return
  if (JSON.stringify(schema.const) !== JSON.stringify(value)) {
    failures.push({ path, message: '与 const 约定值不一致' })
  }
}

function validateStringConstraints(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  if (typeof value !== 'string') return
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    failures.push({ path, message: `字符串长度不足，至少 ${schema.minLength}` })
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    failures.push({ path, message: `字符串长度超出，至多 ${schema.maxLength}` })
  }
  if (typeof schema.pattern === 'string') {
    let regex: RegExp | undefined
    try {
      regex = new RegExp(schema.pattern)
    } catch {
      // 无效正则不阻断校验，跳过该约束
    }
    if (regex && !regex.test(value)) {
      failures.push({ path, message: `不匹配 pattern：${schema.pattern}` })
    }
  }
}

function validateNumberConstraints(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    failures.push({ path, message: `小于最小值 ${schema.minimum}` })
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    failures.push({ path, message: `大于最大值 ${schema.maximum}` })
  }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    failures.push({ path, message: `须大于 ${schema.exclusiveMinimum}` })
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    failures.push({ path, message: `须小于 ${schema.exclusiveMaximum}` })
  }
  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    const quotient = value / schema.multipleOf
    if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
      failures.push({ path, message: `须为 ${schema.multipleOf} 的整数倍` })
    }
  }
}

function validateType(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  const schemaType = schema.type
  if (schemaType == null) return
  const allowedTypes = Array.isArray(schemaType)
    ? schemaType.filter((item): item is string => typeof item === 'string')
    : typeof schemaType === 'string'
      ? [schemaType]
      : []
  if (allowedTypes.length === 0 || allowedTypes.some((type) => matchesJsonSchemaType(value, type))) return
  failures.push({ path, message: `类型不匹配，期望 ${allowedTypes.join(' | ')}` })
}

function validateEnum(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  if (!Array.isArray(schema.enum)) return
  const matched = schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
  if (!matched) failures.push({ path, message: '不在 enum 允许值内' })
}

function validateObject(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  if (!isRecord(value)) return

  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []
  for (const key of required) {
    if (!(key in value)) failures.push({ path: `${path}.${key}`, message: '缺少必填字段' })
  }

  const properties = isRecord(schema.properties) ? schema.properties : undefined
  if (properties) {
    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in value) || !isRecord(childSchema)) continue
      failures.push(...validateSchemaValue(value[key], childSchema, `${path}.${key}`))
    }
  }

  if (schema.additionalProperties === false && properties) {
    const allowed = new Set(Object.keys(properties))
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) failures.push({ path: `${path}.${key}`, message: '不允许的额外字段' })
    }
  }
}

function validateArray(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  if (!Array.isArray(value)) return
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    failures.push({ path, message: `元素数量不足，至少 ${schema.minItems}` })
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    failures.push({ path, message: `元素数量超出，至多 ${schema.maxItems}` })
  }
  const itemSchema = schema.items
  if (!isRecord(itemSchema)) return
  value.forEach((item, index) => {
    failures.push(...validateSchemaValue(item, itemSchema, `${path}[${index}]`))
  })
}

function validateCombinators(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  failures: ValidationFailure[],
): void {
  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) {
      if (isRecord(child)) failures.push(...validateSchemaValue(value, child, path))
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((child) => isRecord(child) && validateSchemaValue(value, child, path).length === 0)
    if (!matched) failures.push({ path, message: '不满足 anyOf 中任一 schema' })
  }

  if (Array.isArray(schema.oneOf)) {
    const matchCount = schema.oneOf.filter((child) =>
      isRecord(child) && validateSchemaValue(value, child, path).length === 0).length
    if (matchCount !== 1) failures.push({ path, message: '不满足 oneOf 的唯一匹配要求' })
  }
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return true
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
