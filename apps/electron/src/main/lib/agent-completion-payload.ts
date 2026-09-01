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
  run: Readonly<Pick<AgentSendInput, 'sessionId' | 'triggeredBy'> & { runGeneration?: number }>,
  details: AgentStreamCompletionDetails = {},
): AgentStreamCompletePayload {
  const { runGeneration, ...otherDetails } = details
  return {
    sessionId: run.sessionId,
    triggeredBy: run.triggeredBy,
    ...otherDetails,
    ...(runGeneration != null ? { runGeneration } : run.runGeneration != null ? { runGeneration: run.runGeneration } : {}),
  }
}

export function sendAgentStreamComplete(
  target: AgentStreamCompleteTarget,
  run: Readonly<Pick<AgentSendInput, 'sessionId' | 'triggeredBy'> & { runGeneration?: number }>,
  details: AgentStreamCompletionDetails = {},
): void {
  target.send(
    AGENT_IPC_CHANNELS.STREAM_COMPLETE,
    buildAgentStreamCompletePayload(run, details),
  )
}
