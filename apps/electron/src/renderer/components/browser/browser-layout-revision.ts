/**
 * Use a time-based epoch with sub-millisecond sequence numbers rather than a
 * module-local counter starting at zero. The main process outlives renderer
 * reloads, so a fresh renderer must always publish revisions newer than the
 * revisions from its predecessor.
 */
let nextRevision = Date.now() * 1_000

export function nextBrowserLayoutRevision(): number {
  nextRevision += 1
  return nextRevision
}
