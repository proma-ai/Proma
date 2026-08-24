/**
 * Stop requests arriving while a run is reserved but has not reached the
 * orchestrator must be remembered. Otherwise the later run starts with no
 * active adapter query for `abort()` to cancel.
 */
export function shouldStopBeforeAgentRun(
  isStarting: boolean,
  isDispatchingQueuedRun: boolean,
): boolean {
  return isStarting || isDispatchingQueuedRun
}
