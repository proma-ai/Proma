import { describe, expect, test } from 'bun:test'
import type { Model, OpenAICodexResponsesOptions } from '@earendil-works/pi-ai/compat'
import type { Dispatcher } from 'undici'
import {
  completeCodexTitleRequest,
  extractCodexResponseText,
  type CodexTitleRequestEnvironment,
  type CodexTitleRuntime,
} from './pi-codex-title-generator'

const model = {} as Model<'openai-codex-responses'>

function createEnvironment(dispatcher?: Dispatcher): CodexTitleRequestEnvironment & { closed: Dispatcher | undefined; installed: boolean } {
  return {
    dispatcher,
    closed: undefined,
    installed: false,
    installRequestProxyFetch() { this.installed = true },
    runWithRequestProxy(_dispatcher, operation) { return operation() },
    async closeRequestProxyDispatcher(closed) { this.closed = closed },
  }
}

describe('Codex OAuth 标题生成', () => {
  test('Given Pi response with reasoning and text When extracting title Then returns visible text only', () => {
    expect(extractCodexResponseText([
      { type: 'thinking', text: '先理解用户意图' },
      { type: 'text', text: '修复 OAuth 登录' },
      { type: 'toolCall', text: 'ignored' },
      { type: 'text', text: '问题' },
    ])).toBe('修复 OAuth 登录问题')
  })

  test('Given Pi response without text When extracting title Then returns an empty string', () => {
    expect(extractCodexResponseText([{ type: 'thinking', text: '不应显示' }])).toBe('')
  })

  test('Given Codex runtime When requesting title Then uses a small non-reasoning SSE request and closes its proxy', async () => {
    let receivedOptions: OpenAICodexResponsesOptions | undefined
    let receivedPrompt: string | undefined
    const runtime: CodexTitleRuntime = {
      async complete(_model, context, options) {
        receivedPrompt = context.messages[0]?.role === 'user' ? context.messages[0].content as string : undefined
        receivedOptions = options
        return { content: [{ type: 'text', text: 'OAuth 标题修复' }] }
      },
    }
    const dispatcher = {} as Dispatcher
    const environment = createEnvironment(dispatcher)

    await expect(completeCodexTitleRequest(runtime, model, '生成标题', environment)).resolves.toBe('OAuth 标题修复')
    expect(receivedPrompt).toBe('生成标题')
    expect(receivedOptions).toEqual({
      transport: 'sse',
      maxTokens: 40,
      timeoutMs: 15_000,
      maxRetries: 0,
      reasoningEffort: 'none',
      reasoningSummary: 'off',
      textVerbosity: 'low',
      toolChoice: 'none',
    })
    expect(environment.installed).toBe(true)
    expect(environment.closed).toBe(dispatcher)
  })

  test('Given Codex request failure When completing title Then still closes its proxy', async () => {
    const runtime: CodexTitleRuntime = {
      async complete() { throw new Error('quota exceeded') },
    }
    const dispatcher = {} as Dispatcher
    const environment = createEnvironment(dispatcher)

    await expect(completeCodexTitleRequest(runtime, model, '生成标题', environment)).rejects.toThrow('quota exceeded')
    expect(environment.closed).toBe(dispatcher)
  })
})
