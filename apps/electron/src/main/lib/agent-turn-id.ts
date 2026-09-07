import { randomUUID } from 'node:crypto'

/**
 * Creates an opaque, globally unique billing correlation ID for one outer
 * Agent run. It intentionally excludes session-local counters so resuming a
 * session after an Electron main-process restart cannot reuse an older ID.
 */
export function createAgentTurnId(): string {
  return randomUUID()
}
