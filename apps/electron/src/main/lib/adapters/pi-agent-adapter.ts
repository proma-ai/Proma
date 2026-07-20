/**
 * Pi Agent SDK 适配器
 *
 * Proma 内部继续使用 SDKMessage 兼容协议，避免渲染层、Jotai 状态、
 * JSONL 持久化和历史会话展示在 SDK 迁移时一起改名。
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { Dispatcher } from 'undici'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  AgentThinkingLevel,
  AgentProviderAdapter,
  AgentQueryInput,
  ErrorCode,
  JsonSchemaOutputFormat,
  PromaPermissionMode,
  ProviderType,
  RecoveryAction,
  SendQueuedMessageOptions,
  SDKMessage,
  SDKUserMessageInput,
  TypedError,
} from '@proma/shared'
import { isCodexFastModeSupportedModel, isOpenAIReasoningSupportedModel } from '@proma/shared'
import {
  THINKING_SIGNATURE_ERROR_MESSAGE,
  THINKING_SIGNATURE_ERROR_TITLE,
  isThinkingSignatureError as matchesThinkingSignatureError,
} from '@proma/shared'
import type { CanUseToolOptions, PermissionResult } from '../agent-permission-service'
import { TRANSIENT_NETWORK_PATTERN, isMalformedResponseError } from '../error-patterns'

import type {
  AgentSession,
  AgentSessionEvent,
  ResourceLoader,
  Skill,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Transport as PiAgentTransport } from '@earendil-works/pi-ai'
import type { AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai/compat'
import { Type, type TSchema } from 'typebox'
import {
  appendOutputFormatInstruction,
  createAgentRuntimeGuard,
  type AgentRuntimeGuard,
} from '../agent-runtime-guards'
import { createPromaAgentsFilesOverride } from './pi-resource-loader-overrides'
import { createCodexRequestSettingsExtension, withCodexFastModeServiceTier } from './pi-codex-request-settings'
import { mergeRuntimeEnv, type AgentRuntimeEnv } from '../agent-runtime-env'
import {
  convertPiMessage,
  convertResultMessage,
  displayToolName,
  dropTrailingAbortedAssistant,
  hasToolResult,
  isAbortedAssistantMessage,
  isAssistantPiMessage,
  normalizePermissionInput,
  restorePiInput,
} from './pi-message-adapter'
import { DEFAULT_CONTEXT_WINDOW, buildModel } from './pi-model-registry'
import { createPartialMessageCoalescer, type PartialMessageCoalescer } from './pi-streaming-control'
import {
  closePiRequestProxyDispatcher,
  createPiRequestProxyDispatcher,
  installPiRequestProxyFetch,
  runWithPiRequestProxy,
} from './pi-request-proxy'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type BashOperations = import('@earendil-works/pi-coding-agent').BashOperations
type BashToolOptions = import('@earendil-works/pi-coding-agent').BashToolOptions
type SkillLoadResult = ReturnType<ResourceLoader['getSkills']>

/** Pi SDK 查询选项（扩展通用 AgentQueryInput） */
export interface PiAgentQueryOptions extends AgentQueryInput {
  apiKey: string
  baseUrl?: string
  provider: ProviderType
  channelName?: string
  maxTurns?: number
  permissionMode: PromaPermissionMode
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ) => Promise<PermissionResult>
  systemPrompt: string
  resumeSessionId?: string
  piAgentDir: string
  piSessionDir: string
  customTools?: ToolDefinition[]
  onSessionId?: (sdkSessionId: string) => void
  onModelResolved?: (model: string) => void
  onContextWindow?: (contextWindow: number) => void
  thinkingLevel?: AgentThinkingLevel
  maxBudgetUsd?: number
  outputFormat?: JsonSchemaOutputFormat
  /** Proma 聚合的附加目录；Pi 内置工具 factory 不接收多 root 参数，编排层会把它们注入 systemPrompt。 */
  additionalDirectories?: string[]
  additionalSkillPaths?: string[]
  /** 当前用户输入显式引用的 Skill name（兼容历史 slug 已在编排层归一化） */
  skillMentions?: string[]
  proxyUrl?: string
  /** Pi 模型请求传输策略：auto / sse / websocket / websocket-cached */
  transport?: PiAgentTransport
  /** HTTP 头/响应体空闲超时，单位毫秒；0 表示交给 Pi SDK 禁用超时 */
  httpIdleTimeoutMs?: number
  /** WebSocket 建连超时，单位毫秒；0 表示交给 Pi SDK 禁用超时 */
  websocketConnectTimeoutMs?: number
  runtimeEnv?: AgentRuntimeEnv
  /** 手动压缩请求：走 pi 原生 session.compact()，而非把 /compact 当普通 prompt 发给模型 */
  compactRequest?: boolean
  /** ChatGPT Codex Fast Mode；仅 openai-codex 的受支持模型实际注入 priority service tier。 */
  codexFastMode?: boolean
  /** 会话级 OpenAI（Codex OAuth / Responses API）思考深度。 */
  openAIThinkingLevel?: AgentThinkingLevel
}

interface ActivePiSession {
  session?: AgentSession
  resourceLoader?: ResourceLoader
  ready: Promise<AgentSession>
  resolveReady: (session: AgentSession) => void
  rejectReady: (error: unknown) => void
  abortRequested: boolean
  interrupting: boolean
  pendingInterruptPrompts: PendingInterruptPrompt[]
  interruptAbortPromise?: Promise<void>
  readySettled: boolean
  disposed: boolean
  runtimeGuard?: AgentRuntimeGuard
}

interface PendingInterruptPrompt {
  content: string
  resolveAccepted: () => void
  rejectAccepted: (error: unknown) => void
}

interface PromaTaskItem {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled' | 'error' | 'deleted'
  description?: string
  activeForm?: string
  blocks?: string[]
}

interface AssistantMessageState {
  uuid?: string
}

export interface PiRemoteConnectionSettings {
  httpProxy?: string
  transport?: PiAgentTransport
  httpIdleTimeoutMs?: number
  websocketConnectTimeoutMs?: number
}

interface AsyncQueue<T> {
  push: (value: T) => void
  fail: (error: unknown) => void
  close: () => void
  next: () => Promise<IteratorResult<T>>
}

/** Pi 原生每个 delta 都携带累计消息；20fps 足够流畅，同时避免 IPC/React 事件风暴。 */
const PI_PARTIAL_UPDATE_INTERVAL_MS = 50

function getCaseInsensitiveRuntimeEnvValue(env: Record<string, string> | undefined, key: string): string | undefined {
  if (!env) return undefined
  const exact = env[key]
  if (exact) return exact
  const foundKey = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())
  const value = foundKey ? env[foundKey] : undefined
  return value || undefined
}

function normalizeProxyUrl(proxyUrl: string | undefined): string | undefined {
  const trimmed = proxyUrl?.trim()
  return trimmed ? trimmed : undefined
}

function resolvePiHttpProxy(input: Pick<PiAgentQueryOptions, 'proxyUrl' | 'runtimeEnv'>): string | undefined {
  return normalizeProxyUrl(input.proxyUrl)
    ?? normalizeProxyUrl(getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'HTTPS_PROXY'))
    ?? normalizeProxyUrl(getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'HTTP_PROXY'))
    ?? normalizeProxyUrl(getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'ALL_PROXY'))
}

function isNonNegativeFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0
}

export function buildPiRemoteConnectionSettings(
  input: Pick<
    PiAgentQueryOptions,
    'provider' | 'proxyUrl' | 'runtimeEnv' | 'transport' | 'httpIdleTimeoutMs' | 'websocketConnectTimeoutMs'
  >,
): PiRemoteConnectionSettings {
  const httpProxy = resolvePiHttpProxy(input)
  // Node/Electron 的 WebSocket 不支持请求级 HTTP 代理注入；有代理的 Codex
  // 默认改走可由 undici dispatcher 承载的 SSE。用户显式选择 transport 时保留其意图。
  const transport = input.transport ?? (httpProxy && input.provider === 'openai-codex' ? 'sse' : undefined)
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(transport ? { transport } : {}),
    ...(isNonNegativeFiniteNumber(input.httpIdleTimeoutMs) ? { httpIdleTimeoutMs: input.httpIdleTimeoutMs } : {}),
    ...(isNonNegativeFiniteNumber(input.websocketConnectTimeoutMs)
      ? { websocketConnectTimeoutMs: input.websocketConnectTimeoutMs }
      : {}),
  }
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = []
  const waiters: Array<(result: IteratorResult<T>) => void> = []
  let closed = false
  let failure: unknown

  const flush = (): void => {
    while (waiters.length > 0 && (values.length > 0 || closed || failure)) {
      const waiter = waiters.shift()!
      if (values.length > 0) {
        waiter({ value: values.shift()!, done: false })
      } else if (failure) {
        const err = failure
        failure = undefined
        Promise.resolve().then(() => { throw err }).catch(() => {})
        waiter(Promise.reject(err) as unknown as IteratorResult<T>)
      } else {
        waiter({ value: undefined, done: true })
      }
    }
  }

  return {
    push(value) {
      if (closed) return
      values.push(value)
      flush()
    },
    fail(error) {
      if (closed) return
      failure = error
      closed = true
      flush()
    },
    close() {
      closed = true
      flush()
    },
    next() {
      if (values.length > 0) {
        return Promise.resolve({ value: values.shift()!, done: false })
      }
      if (failure) {
        const err = failure
        failure = undefined
        return Promise.reject(err)
      }
      if (closed) {
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve))
    },
  }
}

const FRIENDLY_ERROR_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /api key|unauthorized|invalid.*key|authentication/i,
    message: '请检查是否选择了正确的 Proma 供应渠道和模型',
  },
  {
    pattern: /validation|schema/i,
    message: 'API 请求格式校验失败，请重试或开启新会话',
  },
]

const MAX_ERROR_MESSAGE_LENGTH = 5000
const SESSION_READY_TIMEOUT_MS = 60_000
const PROMPT_TOO_LONG_PATTERNS = [
  'prompt is too long',
  'prompt_too_long',
  'input is too long',
  'context_length_exceeded',
  'maximum context length',
  'context length',
  'context window',
  'maximum context',
  'token limit',
  'too many tokens',
  'exceeds the model',
  'exceed the model',
] as const
const SKILL_COMMAND_PATTERN = /\/skill:([A-Za-z0-9][A-Za-z0-9._-]*)/g

function createActivePiSession(): ActivePiSession {
  let resolveReady!: (session: AgentSession) => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<AgentSession>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  ready.catch(() => {})
  return {
    ready,
    resolveReady,
    rejectReady,
    abortRequested: false,
    interrupting: false,
    pendingInterruptPrompts: [],
    readySettled: false,
    disposed: false,
  }
}

function resolveActiveReady(active: ActivePiSession, session: AgentSession): void {
  if (active.readySettled) return
  active.readySettled = true
  active.resolveReady(session)
}

function rejectActiveReady(active: ActivePiSession, error: unknown): void {
  if (active.readySettled) return
  active.readySettled = true
  active.rejectReady(error)
}

function createAbortError(): Error {
  const error = new Error('Agent 执行已停止')
  error.name = 'AbortError'
  return error
}

function rejectPendingInterruptPrompts(active: ActivePiSession, error: unknown): void {
  const pending = active.pendingInterruptPrompts.splice(0)
  for (const prompt of pending) {
    prompt.rejectAccepted(error)
  }
}

async function waitForActiveSession(active: ActivePiSession): Promise<AgentSession> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      active.ready,
      new Promise<AgentSession>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Agent 会话初始化超时，请稍后重试')), SESSION_READY_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function friendlyErrorMessage(raw: string): string {
  const isLong = raw.length > MAX_ERROR_MESSAGE_LENGTH
  const sample = isLong ? raw.slice(0, MAX_ERROR_MESSAGE_LENGTH) : raw
  for (const { pattern, message } of FRIENDLY_ERROR_MESSAGES) {
    if (pattern.test(sample)) return message
  }
  return isLong
    ? sample + `\n\n[错误详情过长 (${(raw.length / 1024).toFixed(0)}KB)，已截断]`
    : raw
}

export function isPromptTooLongError(...messages: Array<string | undefined>): boolean {
  const text = messages
    .filter((message): message is string => typeof message === 'string')
    .join(' ')
    .toLowerCase()
  return PROMPT_TOO_LONG_PATTERNS.some((pattern) => text.includes(pattern))
}

export function isThinkingSignatureError(message: string, originalError?: string): boolean {
  return matchesThinkingSignatureError(message, originalError)
}

function stringifyErrorContent(content: unknown): string | undefined {
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const record = block as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (typeof record.message === 'string') return record.message
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    return text || undefined
  }
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    if (typeof record.error === 'string') return record.error
    return JSON.stringify(record)
  }
  return undefined
}

export function extractErrorDetails(error: {
  error?: { message?: string; errorType?: string }
  errorMessage?: string
  errors?: unknown[]
  message?: { content?: unknown }
  content?: unknown
}): {
  detailedMessage: string
  originalError?: string
} {
  const direct = error.error?.message ?? error.errorMessage
  if (direct) return { detailedMessage: direct, originalError: direct }
  const fromMessage = stringifyErrorContent(error.message?.content ?? error.content)
  if (fromMessage) return { detailedMessage: fromMessage, originalError: fromMessage }
  const fromErrors = Array.isArray(error.errors)
    ? error.errors.map((item) => stringifyErrorContent(item)).filter(Boolean).join('\n')
    : undefined
  if (fromErrors) return { detailedMessage: fromErrors, originalError: fromErrors }
  return { detailedMessage: 'Agent 执行失败', originalError: undefined }
}

/** 各错误码对应的标题与是否可重试（用于构建差异化 TypedError） */
const ERROR_CODE_META: Partial<Record<ErrorCode, { title: string; canRetry: boolean }>> = {
  invalid_api_key: { title: '认证失败', canRetry: true },
  billing_error: { title: '账单错误', canRetry: false },
  rate_limited: { title: '请求频率限制', canRetry: true },
  prompt_too_long: { title: '上下文过长', canRetry: false },
  invalid_request: { title: '请求无效', canRetry: false },
  service_unavailable: { title: '服务暂时不可用', canRetry: true },
  service_error: { title: '服务错误', canRetry: true },
  provider_error: { title: '服务繁忙', canRetry: true },
  network_error: { title: '网络异常', canRetry: true },
  invalid_model: { title: '模型不可用', canRetry: false },
  agent_runtime_not_found: { title: 'Agent 核心未就绪', canRetry: false },
}

/**
 * 判断错误文本是否为 pi runtime 模块加载失败（打包遗漏依赖 / 安装损坏）。
 *
 * 只匹配明确的 Node 模块解析失败措辞，且要求同时提及 pi 运行时包名，
 * 避免上游错误正文里偶然出现包名字符串就被误判为「核心未就绪」（那会错误地丢失可重试性）。
 */
export function isRuntimeNotFoundError(text: string): boolean {
  const isModuleResolutionFailure = /cannot find module|module not found|err_module_not_found|failed to (?:load|resolve)/i.test(text)
  if (!isModuleResolutionFailure) return false
  return /pi-coding-agent|pi-agent-core|@earendil-works/i.test(text)
}

/** 从错误文本中兜底提取 HTTP 状态码（锚定在明确的状态码上下文，避免误匹配正文数字） */
function extractHttpStatusFromErrorText(...messages: Array<string | undefined>): number | null {
  const combined = messages.filter(Boolean).join('\n')
  const patterns = [
    /API Error:\s*(\d{3})/i,
    /API error[^:]*:\s+(\d{3})/i,
    /\b(?:HTTP|status|statusCode)\s*[:=]?\s*(\d{3})\b/i,
    /\b(\d{3})\s+\{[^}]*"error"/is,
  ]
  for (const pattern of patterns) {
    const match = combined.match(pattern)
    const statusCode = match?.[1] ? parseInt(match[1], 10) : NaN
    if (statusCode >= 400 && statusCode < 600) return statusCode
  }
  return null
}

export function mapSDKErrorToTypedError(errorCode: string, message: string, originalError?: string): TypedError {
  const diagnosticText = `${errorCode}\n${message}\n${originalError ?? ''}`

  // thinking-signature：中途切换模型导致思考标签不互认，需保留专属文案与「在新对话继续」动作
  if (isThinkingSignatureError(message, originalError)) {
    return {
      code: 'thinking_signature_invalid',
      title: THINKING_SIGNATURE_ERROR_TITLE,
      message: THINKING_SIGNATURE_ERROR_MESSAGE,
      actions: [
        { key: 'n', label: '在新对话继续', action: 'retry_in_new_session' },
        { key: 'r', label: '重试', action: 'retry' },
      ],
      canRetry: true,
      retryDelayMs: 1000,
      originalError,
    }
  }

  let code: ErrorCode = 'unknown_error'
  const httpStatus = extractHttpStatusFromErrorText(message, originalError, errorCode)
  if (isRuntimeNotFoundError(diagnosticText)) {
    // pi runtime 动态 import 失败（打包遗漏依赖 / 安装损坏），产出定向的「核心未就绪」错误码，
    // 让 UI 给出「请重新安装」引导，而非泛化的 unknown_error
    code = 'agent_runtime_not_found'
  } else if (/api.*key|unauthorized|authentication|invalid.*credential/i.test(diagnosticText)) {
    code = 'invalid_api_key'
  } else if (/billing|quota|insufficient_quota|credit|balance|payment|subscription/i.test(diagnosticText)) {
    code = 'billing_error'
  } else if (/rate.?limit/i.test(diagnosticText) || httpStatus === 429) {
    code = 'rate_limited'
  } else if (isPromptTooLongError(message, originalError, errorCode)) {
    code = 'prompt_too_long'
  } else if (isMalformedResponseError(message, originalError)) {
    // 上游返回无法解析的响应体（网关 HTML 错误页 / SSE 截断 / 脏数据），瞬时异常，可重试
    code = 'service_error'
  } else if (TRANSIENT_NETWORK_PATTERN.test(message) || TRANSIENT_NETWORK_PATTERN.test(originalError ?? '')) {
    code = 'network_error'
  } else if (/overloaded/i.test(diagnosticText) || httpStatus === 529) {
    code = 'provider_error'
  } else if (/service unavailable/i.test(diagnosticText) || httpStatus === 503) {
    code = 'service_unavailable'
  } else if (httpStatus === 500 || httpStatus === 502 || (httpStatus != null && httpStatus >= 500)) {
    // HTTP 5xx（含 500 内部错误 / 502 网关异常）通常为上游瞬时故障，可重试
    code = 'service_error'
  } else if (/invalid request|bad request|400|schema|validation/i.test(diagnosticText)) {
    code = 'invalid_request'
  } else if (/network|fetch|socket|terminated|ECONNRESET/i.test(diagnosticText)) {
    code = 'network_error'
  } else if (/model/i.test(diagnosticText)) {
    code = 'invalid_model'
  }

  const meta = ERROR_CODE_META[code] ?? { title: 'Agent 执行失败', canRetry: false }
  // 认证/渠道配置类错误友好化后文案固定，引导用户直接重新选择模型，而非跳转设置
  const isInvalidChannelOrModel = /请检查是否选择了正确的 Proma 供应渠道和模型/.test(message)

  const actions: RecoveryAction[] = [
    isInvalidChannelOrModel
      ? { key: 'm', label: '重新选择模型', action: 'select_model' }
      : { key: 's', label: '设置', action: 'settings' },
    ...(meta.canRetry ? [{ key: 'r', label: '重试', action: 'retry' }] : []),
    ...(code === 'prompt_too_long' ? [{ key: 'c', label: '压缩上下文', action: 'compact' }] : []),
  ]

  return {
    code,
    title: meta.title,
    message,
    actions,
    canRetry: meta.canRetry,
    retryDelayMs: meta.canRetry ? 1000 : undefined,
    originalError,
  }
}

function findSessionFile(sessionDir: string, sdkSessionId: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined
  for (const entry of readdirSync(sessionDir)) {
    if (entry.endsWith('.jsonl') && entry.includes(sdkSessionId)) {
      return join(sessionDir, entry)
    }
  }
  return undefined
}

function isPathWithinRoot(path: string, root: string): boolean {
  if (path === root) return true
  const rel = relative(root, path)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function buildAllowedSkillRoots(additionalSkillPaths: string[] | undefined): string[] {
  return (additionalSkillPaths ?? [])
    .map((path) => resolveGuardedRealPath(path))
    .filter((path, index, arr) => arr.indexOf(path) === index)
}

function isPromaSkillPath(path: string | undefined, allowedRoots: string[]): boolean {
  if (!path || allowedRoots.length === 0) return false
  const guardedPath = resolveGuardedRealPath(path)
  return allowedRoots.some((root) => isPathWithinRoot(guardedPath, root))
}

function createPromaSkillsOverride(additionalSkillPaths: string[] | undefined): (base: SkillLoadResult) => SkillLoadResult {
  const allowedRoots = buildAllowedSkillRoots(additionalSkillPaths)
  return (base) => ({
    skills: base.skills.filter((skill) =>
      isPromaSkillPath(skill.filePath, allowedRoots) || isPromaSkillPath(skill.baseDir, allowedRoots)),
    diagnostics: base.diagnostics.filter((diagnostic) => isPromaSkillPath(diagnostic.path, allowedRoots)),
  })
}

function stripSkillFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/, '')
  const frontmatter = normalized.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/)
  return frontmatter ? normalized.slice(frontmatter[0].length) : content
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function skillCommandAliases(skill: Skill): string[] {
  const aliases = [skill.name, basename(skill.baseDir), basename(dirname(skill.filePath))]
  return aliases.filter((alias, index, arr) => Boolean(alias) && arr.indexOf(alias) === index)
}

function extractSkillCommandNames(prompt: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of prompt.matchAll(SKILL_COMMAND_PATTERN)) {
    const name = match[1]?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function buildSkillLookup(skills: Skill[]): Map<string, Skill> {
  const lookup = new Map<string, Skill>()
  for (const skill of skills) {
    for (const alias of skillCommandAliases(skill)) {
      if (!lookup.has(alias)) lookup.set(alias, skill)
    }
  }
  return lookup
}

function formatSkillForPrompt(skill: Skill): string | undefined {
  try {
    const body = stripSkillFrontmatter(readFileSync(skill.filePath, 'utf-8')).trim()
    return `<skill name="${escapeXmlAttribute(skill.name)}" location="${escapeXmlAttribute(skill.filePath)}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
  } catch (error) {
    console.warn(`[Pi SDK] Skill 展开失败: ${skill.filePath}`, error)
    return undefined
  }
}

async function preparePromptWithPromaSkills(
  resourceLoader: ResourceLoader,
  prompt: string,
  explicitSkillNames?: string[],
): Promise<string> {
  await resourceLoader.reload()

  const requestedNames = explicitSkillNames?.length ? explicitSkillNames : extractSkillCommandNames(prompt)
  if (requestedNames.length === 0) return prompt

  const skillLookup = buildSkillLookup(resourceLoader.getSkills().skills)
  const blocks: string[] = []
  const injectedSkillNames = new Set<string>()

  for (const requestedName of requestedNames) {
    const skill = skillLookup.get(requestedName)
    if (!skill || injectedSkillNames.has(skill.name)) continue
    const block = formatSkillForPrompt(skill)
    if (!block) continue
    injectedSkillNames.add(skill.name)
    blocks.push(block)
  }

  if (blocks.length === 0) return prompt
  return `${blocks.join('\n\n')}\n\n${prompt}`
}

function realpathIfExists(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}

function findNearestExistingPath(path: string): string | undefined {
  let current = path
  while (true) {
    try {
      lstatSync(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

function resolveGuardedRealPath(path: string): string {
  const resolved = resolve(path)
  const exact = realpathIfExists(resolved)
  if (exact) return exact

  const nearestExisting = findNearestExistingPath(resolved)
  if (!nearestExisting) return resolved

  const nearestReal = realpathIfExists(nearestExisting)
  if (!nearestReal) return resolved

  const tail = relative(nearestExisting, resolved)
  return tail ? resolve(nearestReal, tail) : nearestReal
}

interface ToolWrapOptions {
  canUseTool?: PiAgentQueryOptions['canUseTool']
}

function wrapToolWithPermission<TParams extends TSchema, TDetails, TState>(
  definition: ToolDefinition<TParams, TDetails, TState>,
  options: ToolWrapOptions,
): ToolDefinition<TParams, TDetails, TState> {
  const canUseTool = options.canUseTool
  const executionMode = 'sequential' as const
  if (!canUseTool) return { ...definition, executionMode }
  return {
    ...definition,
    executionMode,
    async execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>> {
      const rawInput = params as Record<string, unknown>
      let updatedParams = rawInput
      if (canUseTool) {
        const permission = await canUseTool(displayToolName(definition.name, rawInput), normalizePermissionInput(definition.name, rawInput), {
          signal: signal ?? new AbortController().signal,
          toolUseID: toolCallId,
          displayName: definition.label,
          description: definition.description,
        })
        if (permission.behavior === 'deny') {
          throw new Error(permission.message)
        }
        updatedParams = restorePiInput(definition.name, rawInput, permission.updatedInput)
      }
      return definition.execute(
        toolCallId,
        updatedParams as typeof params,
        signal,
        onUpdate as AgentToolUpdateCallback<TDetails> | undefined,
        ctx,
      ) as Promise<AgentToolResult<TDetails>>
    },
  }
}

function createJsonToolResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    details: payload,
  } as AgentToolResult<unknown>
}

function createTextToolResult(text: string, details?: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details,
  } as AgentToolResult<unknown>
}

function stringFromInput(input: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return fallback
}

function normalizeTaskStatus(value: unknown, fallback: PromaTaskItem['status']): PromaTaskItem['status'] {
  if (
    value === 'pending' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'blocked' ||
    value === 'cancelled' ||
    value === 'error' ||
    value === 'deleted'
  ) {
    return value
  }
  return fallback
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => String(item).trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function buildPromaProductToolDefinitions(sdk: PiSdk, canUseTool: PiAgentQueryOptions['canUseTool']): ToolDefinition[] {
  const tasks = new Map<string, PromaTaskItem>()
  let nextTaskId = 1

  const definitions = [
    sdk.defineTool({
      name: 'EnterPlanMode',
      label: '进入计划模式',
      description: '进入 Proma 计划模式。进入后只能调研、整理计划，并等待用户批准后再执行写操作。',
      promptSnippet: '进入计划模式，先调研并输出计划，再等待用户确认。',
      parameters: Type.Object({
        reason: Type.Optional(Type.String({ description: '进入计划模式的原因。' })),
      }),
      async execute(_toolCallId, params) {
        return createTextToolResult('已进入计划模式。', { active: true, input: params })
      },
    }),
    sdk.defineTool({
      name: 'ExitPlanMode',
      label: '提交计划审批',
      description: '向用户提交计划并请求批准。用户批准后才能退出计划模式并继续执行。',
      promptSnippet: '提交计划审批，等待用户批准后继续执行。',
      parameters: Type.Object({
        plan: Type.Optional(Type.String({ description: '计划正文或摘要。' })),
        allowedPrompts: Type.Optional(Type.Array(Type.Object({
          tool: Type.String({ description: '批准后可执行的工具，通常为 Bash。' }),
          prompt: Type.String({ description: '批准后可执行的命令或操作描述。' }),
        }))),
      }),
      async execute(_toolCallId, params) {
        return createTextToolResult('计划已获批准，可以继续执行。', { approved: true, input: params })
      },
    }),
    sdk.defineTool({
      name: 'AskUserQuestion',
      label: '询问用户',
      description: '当需要用户选择、补充信息或确认偏好时调用，Proma 会展示可交互问答横幅。',
      promptSnippet: '向用户提出结构化问题并等待回答。',
      parameters: Type.Object({
        questions: Type.Array(Type.Object({
          question: Type.String({ description: '要询问用户的问题。' }),
          header: Type.Optional(Type.String({ description: '简短标题。' })),
          multiSelect: Type.Optional(Type.Boolean({ description: '是否允许多选。' })),
          options: Type.Optional(Type.Array(Type.Object({
            label: Type.String({ description: '选项标签。' }),
            description: Type.Optional(Type.String({ description: '选项说明。' })),
            preview: Type.Optional(Type.String({ description: '可选预览内容。' })),
          }))),
        })),
        answers: Type.Optional(Type.Record(Type.String(), Type.String())),
      }),
      async execute(_toolCallId, params) {
        const input = params as Record<string, unknown>
        return createJsonToolResult({ answers: input.answers ?? {} })
      },
    }),
    sdk.defineTool({
      name: 'TaskCreate',
      label: '创建任务',
      description: '创建一个可见进度任务，用于多步骤或长耗时工作。',
      promptSnippet: '创建一个可见进度任务。',
      parameters: Type.Object({
        subject: Type.String({ description: '任务标题。' }),
        description: Type.Optional(Type.String({ description: '任务说明。' })),
        activeForm: Type.Optional(Type.String({ description: '当前活动形态或阶段。' })),
        blocks: Type.Optional(Type.Array(Type.String({ description: '关联区块 ID。' }))),
      }),
      async execute(_toolCallId, params) {
        const input = params as Record<string, unknown>
        const id = stringFromInput(input, ['id', 'taskId', 'task_id'], String(nextTaskId++))
        const task: PromaTaskItem = {
          id,
          subject: stringFromInput(input, ['subject', 'title', 'name'], `任务 #${id}`),
          status: 'pending',
          description: typeof input.description === 'string' ? input.description : undefined,
          activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined,
          blocks: normalizeStringArray(input.blocks),
        }
        tasks.set(id, task)
        return createJsonToolResult({ task })
      },
    }),
    sdk.defineTool({
      name: 'TaskUpdate',
      label: '更新任务',
      description: '更新已有可见进度任务的状态、标题或说明。',
      promptSnippet: '更新可见进度任务。',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务 ID。' }),
        status: Type.Optional(Type.Union([
          Type.Literal('pending'),
          Type.Literal('in_progress'),
          Type.Literal('completed'),
          Type.Literal('blocked'),
          Type.Literal('cancelled'),
          Type.Literal('error'),
          Type.Literal('deleted'),
        ])),
        subject: Type.Optional(Type.String({ description: '新的任务标题。' })),
        description: Type.Optional(Type.String({ description: '新的任务说明。' })),
        activeForm: Type.Optional(Type.String({ description: '当前活动形态或阶段。' })),
        blocks: Type.Optional(Type.Array(Type.String({ description: '关联区块 ID。' }))),
      }),
      async execute(_toolCallId, params) {
        const input = params as Record<string, unknown>
        const id = stringFromInput(input, ['taskId', 'task_id', 'id'])
        if (!id) throw new Error('taskId 必填')
        const existing = tasks.get(id)
        const task: PromaTaskItem = {
          id,
          subject: stringFromInput(input, ['subject', 'title', 'name'], existing?.subject ?? `任务 #${id}`),
          status: normalizeTaskStatus(input.status, existing?.status ?? 'pending'),
          description: typeof input.description === 'string' ? input.description : existing?.description,
          activeForm: typeof input.activeForm === 'string' ? input.activeForm : existing?.activeForm,
          blocks: normalizeStringArray(input.blocks) ?? existing?.blocks,
        }
        tasks.set(id, task)
        return createJsonToolResult({ task })
      },
    }),
    sdk.defineTool({
      name: 'TaskGet',
      label: '查看任务',
      description: '读取某个可见进度任务的当前状态。',
      promptSnippet: '查看可见进度任务。',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务 ID。' }),
      }),
      async execute(_toolCallId, params) {
        const input = params as Record<string, unknown>
        const id = stringFromInput(input, ['taskId', 'task_id', 'id'])
        if (!id) throw new Error('taskId 必填')
        const task = tasks.get(id)
        if (!task) throw new Error(`任务不存在: ${id}`)
        return createJsonToolResult({ task })
      },
    }),
    sdk.defineTool({
      name: 'TaskList',
      label: '任务列表',
      description: '列出当前 turn 中已创建的可见进度任务。',
      promptSnippet: '列出可见进度任务。',
      parameters: Type.Object({
        reason: Type.Optional(Type.String({ description: '读取任务列表的原因。' })),
      }),
      async execute() {
        return createJsonToolResult({ tasks: [...tasks.values()].filter((task) => task.status !== 'deleted') })
      },
    }),
    sdk.defineTool({
      name: 'TodoRead',
      label: '读取待办',
      description: '读取当前 turn 的任务列表。兼容 Claude SDK 的 TodoRead。',
      promptSnippet: '读取当前待办列表。',
      parameters: Type.Object({}),
      async execute() {
        return createJsonToolResult({ todos: [...tasks.values()].filter((task) => task.status !== 'deleted') })
      },
    }),
    sdk.defineTool({
      name: 'TodoWrite',
      label: '更新待办',
      description: '以 Claude SDK TodoWrite 兼容格式更新当前 turn 的任务列表。',
      promptSnippet: '更新当前待办列表。',
      parameters: Type.Object({
        todos: Type.Array(Type.Object({
          content: Type.Optional(Type.String()),
          subject: Type.Optional(Type.String()),
          status: Type.Union([
            Type.Literal('pending'),
            Type.Literal('in_progress'),
            Type.Literal('completed'),
            Type.Literal('blocked'),
            Type.Literal('cancelled'),
            Type.Literal('error'),
          ]),
          activeForm: Type.Optional(Type.String()),
        })),
      }),
      async execute(_toolCallId, params) {
        const input = params as { todos?: Array<Record<string, unknown>> }
        tasks.clear()
        for (const [index, todo] of (input.todos ?? []).entries()) {
          const id = String(index + 1)
          tasks.set(id, {
            id,
            subject: stringFromInput(todo, ['subject', 'content'], `待办 #${id}`),
            status: normalizeTaskStatus(todo.status, 'pending'),
            activeForm: typeof todo.activeForm === 'string' ? todo.activeForm : undefined,
          })
        }
        return createJsonToolResult({ todos: [...tasks.values()] })
      },
    }),
  ] as unknown as ToolDefinition[]

  return definitions.map((tool) =>
    wrapToolWithPermission(tool as unknown as ToolDefinition<TSchema, unknown, unknown>, { canUseTool }) as ToolDefinition)
}

const WSL_EXPORT_ENV_KEYS = [
  'PROMA_CLI',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'PROMA_WINDOWS_SHELL',
  'PROMA_WSL_DISTRO',
] as const

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, String.raw`'\''`)}'`
}

function windowsPathToWslPath(value: string): string {
  const driveMatch = value.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!driveMatch) return value
  const drive = driveMatch[1]!.toLowerCase()
  const rest = driveMatch[2]!.replace(/\\/g, '/')
  return `/mnt/${drive}/${rest}`
}

function buildWslCommand(command: string, env: NodeJS.ProcessEnv | undefined): string {
  const exportLines: string[] = []
  for (const key of WSL_EXPORT_ENV_KEYS) {
    const rawValue = env?.[key]
    if (!rawValue) continue
    const value = key === 'PROMA_CLI' ? windowsPathToWslPath(rawValue) : rawValue
    exportLines.push(`export ${key}=${shellQuote(value)}`)
  }

  return exportLines.length > 0
    ? `${exportLines.join('\n')}\n${command}`
    : command
}

function createWslBashOperations(runtimeEnv: AgentRuntimeEnv): BashOperations {
  return {
    exec(command, cwd, options) {
      return new Promise((resolve, reject) => {
        const mergedEnv = mergeRuntimeEnv(process.env, options.env)
        const args = [
          ...(runtimeEnv.wslDistro ? ['--distribution', runtimeEnv.wslDistro] : []),
          '--cd',
          cwd,
          '--exec',
          'bash',
          '-lc',
          buildWslCommand(command, mergedEnv),
        ]
        const child = spawn(runtimeEnv.wslCommand ?? 'wsl.exe', args, {
          env: mergedEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        let settled = false
        let timedOut = false
        let timeoutHandle: NodeJS.Timeout | undefined

        const cleanup = (): void => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          options.signal?.removeEventListener('abort', onAbort)
        }
        const settle = (fn: () => void): void => {
          if (settled) return
          settled = true
          cleanup()
          fn()
        }
        const killChild = (): void => {
          if (!child.killed) child.kill('SIGTERM')
        }
        const onAbort = (): void => {
          killChild()
        }

        if (options.signal?.aborted) {
          killChild()
          settle(() => reject(new Error('aborted')))
          return
        }

        child.stdout?.on('data', options.onData)
        child.stderr?.on('data', options.onData)
        child.on('error', (error) => {
          settle(() => reject(error))
        })
        child.on('close', (code) => {
          if (options.signal?.aborted) {
            settle(() => reject(new Error('aborted')))
          } else if (timedOut) {
            settle(() => reject(new Error(`timeout:${options.timeout}`)))
          } else {
            settle(() => resolve({ exitCode: code }))
          }
        })

        if (options.timeout !== undefined && options.timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true
            killChild()
          }, options.timeout * 1000)
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
}

function createPromaBashToolOptions(runtimeEnv: AgentRuntimeEnv | undefined): BashToolOptions | undefined {
  if (!runtimeEnv) return undefined

  const spawnHook: NonNullable<BashToolOptions['spawnHook']> = ({ command, cwd, env }) => ({
    command,
    cwd,
    env: mergeRuntimeEnv(env, runtimeEnv.env),
  })

  if (runtimeEnv.shellKind === 'wsl') {
    return {
      operations: createWslBashOperations(runtimeEnv),
      spawnHook,
    }
  }

  return {
    ...(runtimeEnv.shellPath && { shellPath: runtimeEnv.shellPath }),
    spawnHook,
  }
}

function buildBuiltinToolDefinitions(
  sdk: PiSdk,
  cwd: string,
  canUseTool: PiAgentQueryOptions['canUseTool'],
  runtimeEnv: AgentRuntimeEnv | undefined,
): ToolDefinition[] {
  const definitions = [
    sdk.createReadToolDefinition(cwd),
    sdk.createBashToolDefinition(cwd, createPromaBashToolOptions(runtimeEnv)),
    sdk.createEditToolDefinition(cwd),
    sdk.createWriteToolDefinition(cwd),
    sdk.createGrepToolDefinition(cwd),
    sdk.createFindToolDefinition(cwd),
    sdk.createLsToolDefinition(cwd),
  ] as unknown as ToolDefinition[]

  return definitions.map((tool) =>
    wrapToolWithPermission(tool as unknown as ToolDefinition<TSchema, unknown, unknown>, { canUseTool }) as ToolDefinition)
}

function wrapCustomToolDefinitions(
  tools: ToolDefinition[] | undefined,
  canUseTool: PiAgentQueryOptions['canUseTool'],
): ToolDefinition[] {
  return (tools ?? []).map((tool) =>
    wrapToolWithPermission(tool as unknown as ToolDefinition<TSchema, unknown, unknown>, { canUseTool }) as ToolDefinition)
}

export function installRuntimeGuardHooks(session: AgentSession, guard: AgentRuntimeGuard): void {
  const previousAfterToolCall = session.agent.afterToolCall
  session.agent.afterToolCall = async (context, signal) => {
    const previousResult = await previousAfterToolCall?.(context, signal)
    const resultAfterPreviousHooks = {
      content: previousResult?.content ?? context.result.content,
      details: previousResult?.details ?? context.result.details,
      terminate: previousResult?.terminate ?? context.result.terminate,
    }
    const guardedResult = guard.applyToolResult(resultAfterPreviousHooks)

    if (!previousResult && guardedResult.terminate === context.result.terminate) {
      return undefined
    }

    return {
      ...previousResult,
      terminate: guardedResult.terminate,
    }
  }

  const previousPrepareNextTurnWithContext = session.agent.prepareNextTurnWithContext
  session.agent.prepareNextTurnWithContext = async (context, signal) => {
    const previousSnapshot = await previousPrepareNextTurnWithContext?.(context, signal)
    if (guard.shouldStopBeforeNextTurn()) {
      // Pi 的 steer/follow-up 队列在 turn 完成后才 drain；达到 Proma 上限时必须在这里清空，
      // 否则纯文本 turn 之后追加的队列消息会绕过 afterToolCall 继续进入下一轮。
      session.agent.clearAllQueues()
    }
    return previousSnapshot
  }
}

export class PiAgentAdapter implements AgentProviderAdapter {
  private activeSessions = new Map<string, ActivePiSession>()

  async *query(input: PiAgentQueryOptions): AsyncIterable<SDKMessage> {
    const active = createActivePiSession()
    this.activeSessions.set(input.sessionId, active)
    const queue = createAsyncQueue<SDKMessage>()
    const runtimeGuard = createAgentRuntimeGuard(input)
    active.runtimeGuard = runtimeGuard
    let unsubscribe: (() => void) | undefined
    let requestProxyDispatcher: Dispatcher | undefined
    let partialAssistantCoalescer: PartialMessageCoalescer<{ message: AssistantMessage; uuid: string }> | undefined

    const cleanupActiveSession = (): void => {
      try {
        unsubscribe?.()
        unsubscribe = undefined
        partialAssistantCoalescer?.dispose()
        partialAssistantCoalescer = undefined
        if (!active.disposed) {
          active.disposed = true
          rejectPendingInterruptPrompts(active, createAbortError())
          active.session?.dispose()
        }
        if (this.activeSessions.get(input.sessionId) === active) {
          this.activeSessions.delete(input.sessionId)
        }
      } finally {
        void closePiRequestProxyDispatcher(requestProxyDispatcher)
        requestProxyDispatcher = undefined
      }
    }

    try {
      installPiRequestProxyFetch()
      requestProxyDispatcher = createPiRequestProxyDispatcher({
        proxyUrl: resolvePiHttpProxy(input),
        noProxy: getCaseInsensitiveRuntimeEnvValue(input.runtimeEnv?.env, 'NO_PROXY'),
        httpIdleTimeoutMs: input.httpIdleTimeoutMs,
      })
      const sdk = await import('@earendil-works/pi-coding-agent')
      const piAi = input.codexFastMode && input.provider === 'openai-codex'
        ? await import('@earendil-works/pi-ai/compat')
        : undefined
      if (active.abortRequested) throw createAbortError()

      if (!existsSync(input.piSessionDir)) mkdirSync(input.piSessionDir, { recursive: true })
      const cwd = input.cwd ?? process.cwd()
      const sessionFile = input.resumeSessionId ? findSessionFile(input.piSessionDir, input.resumeSessionId) : undefined
      if (input.resumeSessionId && !sessionFile) {
        throw new Error(`No conversation found with session ID ${input.resumeSessionId}`)
      }
      const sessionManager = sessionFile
        ? sdk.SessionManager.open(sessionFile, input.piSessionDir, cwd)
        : sdk.SessionManager.create(cwd, input.piSessionDir)
      const { authStorage, registry, model } = await buildModel(sdk, input)
      const customTools = [
        ...buildBuiltinToolDefinitions(
          sdk,
          cwd,
          input.canUseTool,
          input.runtimeEnv,
        ),
        ...buildPromaProductToolDefinitions(sdk, input.canUseTool),
        ...wrapCustomToolDefinitions(input.customTools, input.canUseTool),
      ]

      const settingsManager = sdk.SettingsManager.inMemory({
        // 使用 Pi SDK 原生压缩策略：
        // - 手动压缩由 session.compact() 触发；
        // - 自动压缩由 Pi 在上下文接近窗口上限或溢出恢复时触发。
        compaction: { enabled: true },
        retry: { enabled: false },
        ...buildPiRemoteConnectionSettings(input),
      })
      const resourceLoader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir: input.piAgentDir,
        settingsManager,
        noSkills: true,
        additionalSkillPaths: input.additionalSkillPaths ?? [],
        skillsOverride: createPromaSkillsOverride(input.additionalSkillPaths),
        agentsFilesOverride: createPromaAgentsFilesOverride(),
        ...((input.provider === 'openai-codex' || input.provider === 'openai-responses')
          && model.reasoning
          && isOpenAIReasoningSupportedModel(input.model) && {
            extensionFactories: [createCodexRequestSettingsExtension({
            fastMode: input.codexFastMode,
            thinkingLevel: input.openAIThinkingLevel,
          })],
        }),
        systemPromptOverride: () => input.systemPrompt,
      })
      await resourceLoader.reload()
      active.resourceLoader = resourceLoader

      const skillDiagnostics = resourceLoader.getSkills().diagnostics
      for (const diagnostic of skillDiagnostics) {
        const level = diagnostic.type === 'error' ? 'error' : 'warn'
        console[level](`[Pi SDK] Skill 加载诊断: ${diagnostic.path ?? '(unknown)'} ${diagnostic.message}`)
      }

      const { session } = await sdk.createAgentSession({
        cwd,
        agentDir: input.piAgentDir,
        authStorage,
        modelRegistry: registry,
        settingsManager,
        resourceLoader,
        sessionManager,
        model,
        thinkingLevel: input.thinkingLevel ?? 'off',
        noTools: 'builtin',
        customTools,
      })
      session.agent.toolExecution = 'sequential'
      if (piAi && input.codexFastMode && input.provider === 'openai-codex' && isCodexFastModeSupportedModel(input.model)) {
        // Pi 的通用 streamSimple 会丢弃 provider 专属 serviceTier；这里直接走
        // provider stream，确保 request body 与 usage.cost 都使用 priority tier。
        session.agent.streamFn = async (requestModel, context, options) => {
          const auth = await registry.getApiKeyAndHeaders(requestModel)
          if (!auth.ok) throw new Error(auth.error)

          const env = auth.env || options?.env ? { ...(auth.env ?? {}), ...(options?.env ?? {}) } : undefined
          const retrySettings = settingsManager.getProviderRetrySettings()
          const configuredTimeoutMs = settingsManager.getHttpIdleTimeoutMs()
          const timeoutMs = options?.timeoutMs ?? retrySettings.timeoutMs ?? (configuredTimeoutMs === 0 ? 2_147_483_647 : configuredTimeoutMs)
          const websocketConnectTimeoutMs = options?.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs()

          return piAi.stream(requestModel, context, withCodexFastModeServiceTier({
            ...options,
            apiKey: auth.apiKey,
            env,
            timeoutMs,
            websocketConnectTimeoutMs,
            maxRetries: options?.maxRetries ?? retrySettings.maxRetries,
            maxRetryDelayMs: options?.maxRetryDelayMs ?? retrySettings.maxRetryDelayMs,
            headers: { ...auth.headers, ...options?.headers },
          }))
        }
      }
      // 代理作用域必须只覆盖模型 provider stream：在整个 session.prompt() 链上设
      // AsyncLocalStorage 会把 MCP/产品工具等同一 Agent loop 中的 fetch 也错误地送进 Codex 代理。
      const providerStreamFn = session.agent.streamFn
      session.agent.streamFn = (requestModel, context, options) => runWithPiRequestProxy(
        requestProxyDispatcher,
        () => providerStreamFn(requestModel, context, options),
      )
      installRuntimeGuardHooks(session, runtimeGuard)
      active.session = session
      resolveActiveReady(active, session)

      if (active.abortRequested) {
        await session.abort().catch(() => {})
        throw createAbortError()
      }

      input.onSessionId?.(session.sessionId)
      input.onModelResolved?.(session.model?.id ?? input.model ?? 'default')
      input.onContextWindow?.(model.contextWindow ?? DEFAULT_CONTEXT_WINDOW)

      queue.push({
        type: 'system',
        subtype: 'init',
        session_id: session.sessionId,
        model: session.model?.id ?? input.model,
      } as unknown as SDKMessage)

      let activeAssistant: AssistantMessageState = {}
      let lastPartialAssistant: AssistantMessage | undefined

      const assistantUuidFor = (): string => {
        if (!activeAssistant.uuid) {
          activeAssistant = { uuid: randomUUID() }
        }
        const uuid = activeAssistant.uuid
        if (!uuid) throw new Error('Pi assistant message uuid 初始化失败')
        return uuid
      }

      partialAssistantCoalescer = createPartialMessageCoalescer(({ message, uuid }) => {
        const converted = convertPiMessage(message, session.sessionId, input.model, {
          final: false,
          uuid,
        })
        if (converted?.type === 'assistant') queue.push(converted)
      }, PI_PARTIAL_UPDATE_INTERVAL_MS)

      unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        try {
          switch (event.type) {
            case 'message_update': {
              if (!isAssistantPiMessage(event.message)) break
              lastPartialAssistant = event.message
              // Pi 的 partial 是累计全文。合并为最多 20fps 的最新帧，避免每 token 都在
              // main → IPC → renderer 路径重复复制整段消息；message_end 始终立即透传。
              partialAssistantCoalescer?.schedule({ message: event.message, uuid: assistantUuidFor() })
              break
            }
            case 'message_end': {
              partialAssistantCoalescer?.flush()
              if (active.interrupting && isAbortedAssistantMessage(event.message)) {
                if (lastPartialAssistant) {
                  const converted = convertPiMessage(lastPartialAssistant, session.sessionId, input.model, {
                    final: true,
                    uuid: assistantUuidFor(),
                  })
                  if (converted?.type === 'assistant') queue.push(converted)
                }
                lastPartialAssistant = undefined
                activeAssistant = {}
                break
              }
              runtimeGuard.recordMessage(event.message)
              const isAssistant = isAssistantPiMessage(event.message)
              const converted = convertPiMessage(event.message, session.sessionId, input.model, {
                final: true,
                ...(isAssistant && { uuid: assistantUuidFor() }),
              })
              if (converted && (converted.type !== 'user' || hasToolResult(converted))) queue.push(converted)
              if (isAssistant) {
                activeAssistant = {}
                lastPartialAssistant = undefined
              }
              break
            }
            case 'agent_end':
              if (active.interrupting && active.pendingInterruptPrompts.length > 0) {
                break
              }
              queue.push(convertResultMessage(
                event.messages,
                session.sessionId,
                runtimeGuard.getResultOverride(event.messages),
              ))
              break
            case 'tool_execution_update':
              queue.push({
                type: 'tool_progress',
                session_id: session.sessionId,
                tool_use_id: event.toolCallId,
                tool_name: displayToolName(event.toolName, event.args as Record<string, unknown> | undefined),
                parent_tool_use_id: null,
              } as unknown as SDKMessage)
              break
            case 'compaction_start':
              // 压缩开始（手动 /compact 或自动阈值/溢出触发）：发前端已识别的 compacting system 消息，
              // 展示「正在压缩上下文...」分隔符。此前迁移遗漏了该事件，导致自动压缩与手动压缩都无 UI。
              queue.push({
                type: 'system',
                subtype: 'compacting',
                session_id: session.sessionId,
              } as unknown as SDKMessage)
              break
            case 'compaction_end':
              // 压缩结束：成功则发 compact_boundary 分界线（前端持久化显示「上下文已压缩」），
              // 失败/中止则不发分界线（compacting 指示器会在本轮 result 到达时随 isCompacting 翻 false 消失）。
              if (!event.aborted && event.result) {
                queue.push({
                  type: 'system',
                  subtype: 'compact_boundary',
                  session_id: session.sessionId,
                  summary: event.result.summary,
                } as unknown as SDKMessage)
              }
              break
          }
        } catch (error) {
          queue.fail(error)
        }
      })

      if (input.compactRequest) {
        // 手动压缩：走 pi 原生 session.compact()，而非把 /compact 当普通 prompt 发给模型。
        // compaction_start/end 事件已在上面的 subscribe 中转成 compacting/compact_boundary system 消息；
        // compact() 不发 agent_end，故这里补一个合成 result 消息收束本轮（供 orchestrator 结束消费循环）。
        session.compact()
          .then(() => {
            queue.push({
              type: 'result',
              subtype: 'success',
              usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              terminal_reason: 'completed',
              session_id: session.sessionId,
            } as unknown as SDKMessage)
            queue.close()
          })
          .catch((error) => {
            // 「会话太小无需压缩」/「已压缩」是良性情况，不是执行错误：
            // pi 会抛 "Nothing to compact (session too small)" / "Already compacted"。
            // 这里不 fail 队列（否则前端弹通用「执行错误」），改为正常收尾并给出友好提示。
            const message = error instanceof Error ? error.message : String(error)
            if (/nothing to compact|already compacted/i.test(message)) {
              queue.push({
                type: 'system',
                subtype: 'compact_noop',
                session_id: session.sessionId,
                message: /already compacted/i.test(message)
                  ? '当前上下文已经压缩过，无需重复压缩。'
                  : '当前上下文较小，暂时无需压缩。',
              } as unknown as SDKMessage)
              queue.push({
                type: 'result',
                subtype: 'success',
                usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
                terminal_reason: 'completed',
                session_id: session.sessionId,
              } as unknown as SDKMessage)
              queue.close()
            } else {
              queue.fail(error)
            }
          })
          .finally(cleanupActiveSession)
      } else {
        const runPromptChain = async (): Promise<void> => {
          let nextPrompt: string | undefined = appendOutputFormatInstruction(input.prompt, input.outputFormat)
          let nextInterrupt: PendingInterruptPrompt | undefined
          while (nextPrompt !== undefined) {
            const currentInterrupt = nextInterrupt
            nextInterrupt = undefined
            if (runtimeGuard.shouldStopBeforeNextTurn()) {
              currentInterrupt?.rejectAccepted(createAbortError())
              rejectPendingInterruptPrompts(active, createAbortError())
              return
            }
            let prompt: string
            try {
              prompt = await preparePromptWithPromaSkills(resourceLoader, nextPrompt, input.skillMentions)
            } catch (error) {
              currentInterrupt?.rejectAccepted(error)
              throw error
            }
            nextPrompt = undefined
            try {
              if (active.abortRequested) {
                currentInterrupt?.rejectAccepted(createAbortError())
                rejectPendingInterruptPrompts(active, createAbortError())
                return
              }
              currentInterrupt?.resolveAccepted()
              await session.prompt(prompt, { source: 'rpc' })
            } finally {
              if (active.interrupting) {
                session.agent.state.messages = dropTrailingAbortedAssistant(session.agent.state.messages)
              }
              active.interrupting = false
            }
            if (active.abortRequested) {
              rejectPendingInterruptPrompts(active, createAbortError())
              return
            }
            if (runtimeGuard.shouldStopBeforeNextTurn()) {
              rejectPendingInterruptPrompts(active, createAbortError())
              return
            }
            const pendingInterrupt = active.pendingInterruptPrompts.shift()
            nextInterrupt = pendingInterrupt
            nextPrompt = pendingInterrupt?.content
          }
        }

        runPromptChain()
          .then(() => queue.close())
          .catch((error) => queue.fail(error))
          .finally(cleanupActiveSession)
      }
    } catch (error) {
      rejectActiveReady(active, error)
      queue.fail(error)
    }

    try {
      while (true) {
        const next = await queue.next()
        if (next.done) break
        yield next.value
      }
    } finally {
      cleanupActiveSession()
    }
  }

  abort(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active) return
    active.abortRequested = true
    rejectPendingInterruptPrompts(active, createAbortError())
    if (!active.session) rejectActiveReady(active, createAbortError())
    active.session?.abort().catch(() => {})
  }

  async sendQueuedMessage(
    sessionId: string,
    message: SDKUserMessageInput,
    options?: SendQueuedMessageOptions,
  ): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active) throw new Error('当前会话没有正在运行的 Agent')
    const session = await waitForActiveSession(active)
    if (active.abortRequested) throw createAbortError()
    if (active.runtimeGuard?.shouldStopBeforeNextTurn()) {
      session.agent.clearAllQueues()
      const stopOverride = active.runtimeGuard.getLimitResultOverride()
      throw new Error(stopOverride?.errors[0] ?? 'Agent 已达到运行限制，无法继续追加消息')
    }
    const content = active.resourceLoader
      ? await preparePromptWithPromaSkills(active.resourceLoader, message.message.content, options?.skillMentions)
      : message.message.content
    if (active.runtimeGuard?.shouldStopBeforeNextTurn()) {
      session.agent.clearAllQueues()
      const stopOverride = active.runtimeGuard.getLimitResultOverride()
      throw new Error(stopOverride?.errors[0] ?? 'Agent 已达到运行限制，无法继续追加消息')
    }
    if (options?.interrupt) {
      const accepted = new Promise<void>((resolve, reject) => {
        active.pendingInterruptPrompts.push({
          content,
          resolveAccepted: resolve,
          rejectAccepted: reject,
        })
      })
      accepted.catch(() => {})
      if (session.isStreaming) {
        // Pi 没有单独的 interrupt()；公开取消 API 是 abort()。
        // 这里把 abort 产生的内部 aborted 终态压住，再由 query 的 prompt chain 发送新消息。
        active.interrupting = true
        active.interruptAbortPromise ??= session.abort()
          .finally(() => {
            active.interruptAbortPromise = undefined
          })
        await active.interruptAbortPromise
      }
      await accepted
      options.onAccepted?.()
      return
    }
    if (message.priority === 'now') {
      await session.steer(content)
    } else {
      await session.followUp(content)
    }
    options?.onAccepted?.()
  }

  async cancelQueuedMessage(_sessionId: string, _messageUuid: string): Promise<void> {
    // Pi 的公开 SDK 当前只暴露 clearQueue，不支持按消息 UUID 删除。
  }

  async setPermissionMode(_sessionId: string, _mode: string): Promise<void> {
    // Proma 权限由工具包装层实时读取 sessionPermissionModes，自身无需同步给 Pi。
  }

  dispose(): void {
    for (const active of this.activeSessions.values()) {
      if (!active.disposed) {
        active.disposed = true
        rejectPendingInterruptPrompts(active, createAbortError())
        active.session?.dispose()
      }
      rejectActiveReady(active, createAbortError())
    }
    this.activeSessions.clear()
  }
}

export function cleanupPiRuntimeResources(): void {
  // Pi 是 in-process runtime，旧 Claude SDK 时代那个持久化的 native `claude` CLI 子进程已不存在，
  // 因此不再需要旧的 before-quit 孤儿扫描（它当年只按命令行匹配 'claude-agent-sdk'）。
  //
  // Pi 的 bash 工具确实会 spawn 子进程，但它以 detached 独立进程组启动，abort()/timeout 时由
  // pi 内部 killProcessTree（SIGTERM + 5s SIGKILL）级联杀整个进程组；adapter.dispose()/abort()
  // 会传播 session.abort()/dispose()。故正常路径无需额外兜底。
  //
  // 残留风险（低）：某个 exec 长命令或 stdio MCP 子进程若在 dispose/abort 未覆盖时退出，可能残留。
  // pi 未从公开入口（exports 仅 '.' 与 './rpc-entry'）导出 killTrackedDetachedChildren，
  // 无法在不深依赖其内部实现的前提下调用，故此处保持空实现；如需兜底应由 pi 侧补公开 API。
}
