/**
 * Agent headless runner 注册表
 *
 * 用于主进程内置工具在不直接 import agent-service.ts 的情况下启动/停止真实 Agent 会话，
 * 避免 AgentOrchestrator 与 agent-service 形成难以维护的循环依赖。
 */

import type {
  AgentExternalRunSource,
  AgentMessage,
  AgentSendInput,
} from '@proma/shared'

export interface HeadlessAgentRunCallbacks {
  onError: (error: string) => void
  onComplete: (messages?: AgentMessage[]) => void
  onTitleUpdated: (title: string) => void
  source?: AgentExternalRunSource
}

export type HeadlessAgentRunner = (
  input: AgentSendInput,
  callbacks: HeadlessAgentRunCallbacks,
) => Promise<void>

export type AgentStopper = (sessionId: string) => void

let headlessRunner: HeadlessAgentRunner | null = null
let agentStopper: AgentStopper | null = null

export function setHeadlessAgentRunner(runner: HeadlessAgentRunner): void {
  headlessRunner = runner
}

export function setAgentStopper(stopper: AgentStopper): void {
  agentStopper = stopper
}

export async function runRegisteredHeadlessAgent(
  input: AgentSendInput,
  callbacks: HeadlessAgentRunCallbacks,
): Promise<void> {
  if (!headlessRunner) {
    throw new Error('Agent headless runner 尚未初始化')
  }
  await headlessRunner(input, callbacks)
}

export function stopRegisteredAgent(sessionId: string): void {
  if (!agentStopper) {
    throw new Error('Agent stopper 尚未初始化')
  }
  agentStopper(sessionId)
}
