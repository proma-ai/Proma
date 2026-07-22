import type { AgentSession } from '@earendil-works/pi-coding-agent'

export type PiSessionLifecycle = Pick<AgentSession, 'isStreaming' | 'pendingMessageCount' | 'waitForIdle'>

export function isGoalStartCommand(prompt: string): boolean {
  const normalized = prompt.trim()
  return normalized.startsWith('/goal ') && normalized !== '/goal stop'
}

export async function waitForGoalCommandTurn(
  session: PiSessionLifecycle,
  prompt: string,
): Promise<void> {
  if (!isGoalStartCommand(prompt)) return

  // ExtensionAPI.sendUserMessage() intentionally does not expose its promise.
  // 等一个事件循环，让 Pi 先把内嵌的 Goal turn 标记为 active，再等待它收束。
  await new Promise<void>((resolve) => setImmediate(resolve))
  if (session.isStreaming || session.pendingMessageCount > 0) {
    await session.waitForIdle()
  }
}
