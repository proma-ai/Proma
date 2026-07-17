/**
 * Agent runtime 路由适配器。
 *
 * Orchestrator 只依赖 AgentProviderAdapter；这里按每个会话选择 Claude 或 Pi runtime。
 */

import type { AgentProviderAdapter, AgentQueryInput, AgentRuntime, SDKMessage, SDKUserMessageInput, SendQueuedMessageOptions } from '@proma/shared'

export class RuntimeRoutingAgentAdapter implements AgentProviderAdapter {
  private readonly sessionRuntimes = new Map<string, AgentRuntime>()

  constructor(private readonly adapters: Record<AgentRuntime, AgentProviderAdapter>) {}

  query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const runtime = input.agentRuntime ?? 'claude'
    this.sessionRuntimes.set(input.sessionId, runtime)
    return this.adapters[runtime].query(input)
  }

  abort(sessionId: string): void {
    const runtime = this.sessionRuntimes.get(sessionId)
    if (runtime) {
      this.adapters[runtime].abort(sessionId)
      return
    }

    this.adapters.claude.abort(sessionId)
    this.adapters.pi.abort(sessionId)
  }

  async interruptQuery(sessionId: string): Promise<void> {
    const adapter = this.getAdapter(sessionId)
    await adapter.interruptQuery?.(sessionId)
  }

  dispose(): void {
    this.adapters.claude.dispose()
    this.adapters.pi.dispose()
    this.sessionRuntimes.clear()
  }

  async sendQueuedMessage(
    sessionId: string,
    message: SDKUserMessageInput,
    options?: SendQueuedMessageOptions,
  ): Promise<void> {
    const adapter = this.getAdapter(sessionId)
    if (!adapter.sendQueuedMessage) {
      throw new Error('当前 Agent runtime 不支持追加消息')
    }
    await adapter.sendQueuedMessage(sessionId, message, options)
  }

  async cancelQueuedMessage(sessionId: string, messageUuid: string): Promise<void> {
    const adapter = this.getAdapter(sessionId)
    await adapter.cancelQueuedMessage?.(sessionId, messageUuid)
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    const adapter = this.getAdapter(sessionId)
    await adapter.setPermissionMode?.(sessionId, mode)
  }

  private getAdapter(sessionId: string): AgentProviderAdapter {
    const runtime = this.sessionRuntimes.get(sessionId) ?? 'claude'
    return this.adapters[runtime]
  }
}
