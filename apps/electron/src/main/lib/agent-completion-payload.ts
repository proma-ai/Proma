import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type {
  AgentSendInput,
  AgentStreamCompletePayload,
} from '@proma/shared'

export type AgentStreamCompletionDetails = Omit<
  AgentStreamCompletePayload,
  'sessionId' | 'triggeredBy'
>

export interface AgentStreamCompleteTarget {
  send(channel: string, payload: AgentStreamCompletePayload): void
}

export function buildAgentStreamCompletePayload(
  run: Readonly<Pick<AgentSendInput, 'sessionId' | 'triggeredBy' | 'runGeneration'>>,
  details: AgentStreamCompletionDetails = {},
): AgentStreamCompletePayload {
  return {
    sessionId: run.sessionId,
    triggeredBy: run.triggeredBy,
    ...(run.runGeneration != null ? { runGeneration: run.runGeneration } : {}),
    ...details,
  }
}

export function sendAgentStreamComplete(
  target: AgentStreamCompleteTarget,
  run: Readonly<Pick<AgentSendInput, 'sessionId' | 'triggeredBy' | 'runGeneration'>>,
  details: AgentStreamCompletionDetails = {},
): void {
  target.send(
    AGENT_IPC_CHANNELS.STREAM_COMPLETE,
    buildAgentStreamCompletePayload(run, details),
  )
}
