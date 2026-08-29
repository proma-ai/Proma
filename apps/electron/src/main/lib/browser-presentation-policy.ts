export function isNewBrowserTabLayoutRevision(revision: number, previousRevision: number): boolean {
  return Number.isSafeInteger(revision) && revision > previousRevision
}

export function canBrowserSessionTakeForeground(input: {
  incomingSessionId: string
  foregroundSessionId: string | null
  revision: number
  latestForegroundRevision: number
}): boolean {
  return input.incomingSessionId === input.foregroundSessionId
    || input.revision > input.latestForegroundRevision
}
