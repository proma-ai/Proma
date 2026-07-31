/**
 * 通过 Pi 的 ChatGPT Codex OAuth runtime 发起轻量文本请求。
 *
 * 标题生成不能复用 @proma/core 的 Chat Completions / Messages 请求：
 * Codex OAuth 只支持 Pi 管理的 Responses 协议、认证头和账号路由。此模块复用
 * 相同的 ModelRuntime/credential store，且不写入 Pi 的全局认证目录。
 */

import { randomUUID } from 'node:crypto'
import type { CodexOAuthCredentials } from '@proma/shared'
import type { AssistantMessage, Context, Model, OpenAICodexResponsesOptions } from '@earendil-works/pi-ai/compat'
import type { Dispatcher } from 'undici'
import { buildCodexModel } from './pi-model-registry'
import {
  closePiRequestProxyDispatcher,
  createPiRequestProxyDispatcher,
  installPiRequestProxyFetch,
  runWithPiRequestProxy,
} from './pi-request-proxy'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type CodexModel = Model<'openai-codex-responses'>
type CodexTitleTransport = 'auto' | 'sse'

const TITLE_MAX_OUTPUT_TOKENS = 40
const TITLE_REQUEST_TIMEOUT_MS = 30_000

export interface CodexTitleGenerationInput {
  modelId: string
  prompt: string
  credentials: CodexOAuthCredentials
  proxyUrl?: string
  signal?: AbortSignal
  onCredentialsRefreshed?: (credentials: CodexOAuthCredentials) => void | Promise<void>
}

export interface CodexTitleRuntime {
  complete: (
    model: CodexModel,
    context: Context,
    options: OpenAICodexResponsesOptions,
  ) => Promise<Pick<AssistantMessage, 'content' | 'stopReason' | 'errorMessage'>>
}

export interface CodexTitleRequestEnvironment {
  dispatcher?: Dispatcher
  installRequestProxyFetch: () => void
  runWithRequestProxy: <T>(dispatcher: Dispatcher | undefined, operation: () => T) => T
  closeRequestProxyDispatcher: (dispatcher: Dispatcher | undefined) => Promise<void>
}

export interface CodexTitleConnectionSettings {
  proxyUrl?: string
  noProxy?: string
  transport: CodexTitleTransport
}

function getCaseInsensitiveEnvironmentValue(key: string): string | undefined {
  const exact = process.env[key]
  if (exact?.trim()) return exact.trim()
  const matchedKey = Object.keys(process.env).find((name) => name.toLowerCase() === key.toLowerCase())
  const value = matchedKey ? process.env[matchedKey] : undefined
  return value?.trim() || undefined
}

/**
 * 标题请求沿用前台 Pi Agent 的连接选择：无代理时优先 WebSocket（auto），
 * 有 HTTP 代理时改用可携带 undici dispatcher 的 SSE。
 */
export function resolveCodexTitleConnectionSettings(proxyUrl?: string): CodexTitleConnectionSettings {
  const resolvedProxyUrl = proxyUrl?.trim()
    || getCaseInsensitiveEnvironmentValue('HTTPS_PROXY')
    || getCaseInsensitiveEnvironmentValue('HTTP_PROXY')
    || getCaseInsensitiveEnvironmentValue('ALL_PROXY')
  const noProxy = getCaseInsensitiveEnvironmentValue('NO_PROXY')

  return {
    ...(resolvedProxyUrl && { proxyUrl: resolvedProxyUrl }),
    ...(noProxy && { noProxy }),
    transport: resolvedProxyUrl ? 'sse' : 'auto',
  }
}

/** 从 Pi 响应中抽取可见文本，忽略 reasoning/tool content。 */
export function extractCodexResponseText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/**
 * 完成单次短标题请求。抽出运行环境以便验证请求参数、代理作用域与异常清理。
 */
export async function completeCodexTitleRequest(
  runtime: CodexTitleRuntime,
  model: CodexModel,
  prompt: string,
  environment: CodexTitleRequestEnvironment,
  signal?: AbortSignal,
  transport: CodexTitleTransport = 'auto',
): Promise<string | null> {
  try {
    environment.installRequestProxyFetch()
    const response = await environment.runWithRequestProxy(environment.dispatcher, () => runtime.complete(
      model,
      {
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        // 使用独立的 Pi session ID，确保标题请求不会加入前台 Agent 的 Responses
        // continuation/cache，同时仍携带 Codex 后端需要的 request/session headers。
        sessionId: randomUUID(),
        transport,
        ...(signal && { signal }),
        maxTokens: TITLE_MAX_OUTPUT_TOKENS,
        timeoutMs: TITLE_REQUEST_TIMEOUT_MS,
        maxRetries: 0,
        // Codex Responses 仅接受 concise/detailed/auto；省略 summary 让 Pi 使用
        // 协议默认的 auto，避免向 ChatGPT OAuth 发送不兼容的 off。
        reasoningEffort: 'none',
        textVerbosity: 'low',
        toolChoice: 'none',
      } satisfies OpenAICodexResponsesOptions,
    ))

    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new Error(response.errorMessage?.trim() || 'Codex 标题请求未完成')
    }

    return extractCodexResponseText(response.content).trim() || null
  } finally {
    await environment.closeRequestProxyDispatcher(environment.dispatcher)
  }
}

/**
 * 使用已登录的 ChatGPT Codex 模型生成一个短文本。连接策略与前台 Pi Agent 对齐：
 * 无代理时使用 auto（优先 WebSocket），有 HTTP 代理时使用 SSE。请求失败由调用方按产品语义决定降级方式。
 */
export async function generateCodexTitle(input: CodexTitleGenerationInput): Promise<string | null> {
  const sdk: PiSdk = await import('@earendil-works/pi-coding-agent')
  const { modelRuntime, model } = await buildCodexModel(sdk, {
    model: input.modelId,
    codexOAuthCredentials: input.credentials,
    onCodexOAuthCredentialsRefreshed: input.onCredentialsRefreshed,
  })
  const connection = resolveCodexTitleConnectionSettings(input.proxyUrl)
  const dispatcher = createPiRequestProxyDispatcher({
    proxyUrl: connection.proxyUrl,
    noProxy: connection.noProxy,
    httpIdleTimeoutMs: TITLE_REQUEST_TIMEOUT_MS,
  })

  return completeCodexTitleRequest(
    modelRuntime as CodexTitleRuntime,
    model as CodexModel,
    input.prompt,
    {
      dispatcher,
      installRequestProxyFetch: installPiRequestProxyFetch,
      runWithRequestProxy: runWithPiRequestProxy,
      closeRequestProxyDispatcher: closePiRequestProxyDispatcher,
    },
    input.signal,
    connection.transport,
  )
}
