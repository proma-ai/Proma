/**
 * 通过 Pi 的 ChatGPT Codex OAuth runtime 发起轻量文本请求。
 *
 * 标题生成不能复用 @proma/core 的 Chat Completions / Messages 请求：
 * Codex OAuth 只支持 Pi 管理的 Responses 协议、认证头和账号路由。此模块复用
 * 相同的 ModelRuntime/credential store，且不写入 Pi 的全局认证目录。
 */

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

const TITLE_MAX_OUTPUT_TOKENS = 40
const TITLE_REQUEST_TIMEOUT_MS = 15_000

export interface CodexTitleGenerationInput {
  modelId: string
  prompt: string
  credentials: CodexOAuthCredentials
  proxyUrl?: string
  onCredentialsRefreshed?: (credentials: CodexOAuthCredentials) => void | Promise<void>
}

export interface CodexTitleRuntime {
  complete: (
    model: CodexModel,
    context: Context,
    options: OpenAICodexResponsesOptions,
  ) => Promise<Pick<AssistantMessage, 'content'>>
}

export interface CodexTitleRequestEnvironment {
  dispatcher?: Dispatcher
  installRequestProxyFetch: () => void
  runWithRequestProxy: <T>(dispatcher: Dispatcher | undefined, operation: () => T) => T
  closeRequestProxyDispatcher: (dispatcher: Dispatcher | undefined) => Promise<void>
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
): Promise<string | null> {
  try {
    environment.installRequestProxyFetch()
    const response = await environment.runWithRequestProxy(environment.dispatcher, () => runtime.complete(
      model,
      {
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        transport: 'sse',
        maxTokens: TITLE_MAX_OUTPUT_TOKENS,
        timeoutMs: TITLE_REQUEST_TIMEOUT_MS,
        maxRetries: 0,
        reasoningEffort: 'none',
        reasoningSummary: 'off',
        textVerbosity: 'low',
        toolChoice: 'none',
      } satisfies OpenAICodexResponsesOptions,
    ))

    return extractCodexResponseText(response.content).trim() || null
  } finally {
    await environment.closeRequestProxyDispatcher(environment.dispatcher)
  }
}

/**
 * 使用已登录的 ChatGPT Codex 模型生成一个短文本。请求固定使用 SSE，避免一次标题
 * 生成额外创建 WebSocket；请求失败由调用方按产品语义决定降级方式。
 */
export async function generateCodexTitle(input: CodexTitleGenerationInput): Promise<string | null> {
  const sdk: PiSdk = await import('@earendil-works/pi-coding-agent')
  const { modelRuntime, model } = await buildCodexModel(sdk, {
    model: input.modelId,
    codexOAuthCredentials: input.credentials,
    onCodexOAuthCredentialsRefreshed: input.onCredentialsRefreshed,
  })
  const dispatcher = createPiRequestProxyDispatcher({ proxyUrl: input.proxyUrl, httpIdleTimeoutMs: TITLE_REQUEST_TIMEOUT_MS })

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
  )
}
