/**
 * Vault scroll memory — remembers where a note was being read.
 *
 * Storing raw `scrollTop` pixels does not survive a remount: CodeMirror creates
 * its DOM asynchronously, reports a short document until it has measured the
 * content, and scrolls the initial selection into view after mounting. Both
 * effects can overwrite a pixel offset with 0.
 *
 * The memory therefore stores a document anchor (the position of the topmost
 * visible line) and restores it through CodeMirror's own scrollIntoView effect.
 * A bounded verification window corrects later CodeMirror measurement or
 * selection scrolls without fighting the reader indefinitely.
 */

export interface VaultScrollAnchor {
  /** Document offset of the first visible line. */
  pos: number
  /** Pixels the anchor line was scrolled past, for sub-line accuracy. */
  lineOffset: number
}

export const VAULT_SCROLL_SETTLE_MS = 700
export const VAULT_SCROLL_MAX_RETRIES = 4
export const VAULT_SCROLL_OFFSET_TOLERANCE_PX = 2
export const MAX_VAULT_SCROLL_ANCHORS = 200

// Insertion order is recency order. Reads refresh an entry; writes replace it.
// This bounds renderer-lifetime memory while retaining recently visited notes.
const anchorStore = new Map<string, VaultScrollAnchor>()

function copyAnchor(anchor: VaultScrollAnchor): VaultScrollAnchor {
  return { ...anchor }
}

export function readVaultScrollAnchor(key: string): VaultScrollAnchor | undefined {
  const stored = anchorStore.get(key)
  if (!stored) return undefined
  anchorStore.delete(key)
  anchorStore.set(key, stored)
  return copyAnchor(stored)
}

export function writeVaultScrollAnchor(key: string, anchor: VaultScrollAnchor): void {
  anchorStore.delete(key)
  anchorStore.set(key, copyAnchor(anchor))
  while (anchorStore.size > MAX_VAULT_SCROLL_ANCHORS) {
    const oldestKey = anchorStore.keys().next().value
    if (oldestKey === undefined) break
    anchorStore.delete(oldestKey)
  }
}

export function clearVaultScrollAnchors(): void {
  anchorStore.clear()
}

/** Snapshot for deterministic tests and explicit local inspection. */
export function dumpVaultScrollAnchors(): Record<string, VaultScrollAnchor> {
  return Object.fromEntries(Array.from(anchorStore, ([key, anchor]) => [key, copyAnchor(anchor)]))
}

/**
 * Scroll memory is scoped per Vault, surface, and note: identically named files
 * in different authorized Vaults never share state, and the center Obsidian view
 * and each session's right-workspace tab keep independent positions.
 */
export function getVaultScrollKey(vaultId: string, relativePath: string, sessionId?: string): string {
  return `${vaultId}:${sessionId ? `side:${sessionId}` : 'center'}:${relativePath}`
}

const VAULT_SCROLL_TAKEOVER_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Spacebar',
])

/** Only keys whose normal browser/editor meaning can move the viewport take over. */
export function isVaultScrollTakeoverKey(key: string): boolean {
  return VAULT_SCROLL_TAKEOVER_KEYS.has(key)
}

function anchorsMatch(expected: VaultScrollAnchor, actual: VaultScrollAnchor): boolean {
  return expected.pos === actual.pos
    && Math.abs(expected.lineOffset - actual.lineOffset) <= VAULT_SCROLL_OFFSET_TOLERANCE_PX
}

/** Tracks one mounted editor: restore first, then follow the reader. */
export class VaultScrollSession {
  private anchor: VaultScrollAnchor | null
  private readonly restoreDeadline: number | null
  private readonly maxRetries: number
  private initialRestoreIssued = false
  private restoreRetries = 0
  private userTookOver = false

  constructor(
    stored: VaultScrollAnchor | undefined,
    now: number,
    settleMs = VAULT_SCROLL_SETTLE_MS,
    maxRetries = VAULT_SCROLL_MAX_RETRIES,
  ) {
    this.anchor = stored ? copyAnchor(stored) : null
    const needsRestore = Boolean(stored && (stored.pos > 0 || stored.lineOffset > 0))
    this.restoreDeadline = needsRestore ? now + settleMs : null
    this.maxRetries = maxRetries
  }

  /** Issues the one initial restore, if this session has an anchor to restore. */
  beginRestore(now: number): VaultScrollAnchor | null {
    if (this.initialRestoreIssued || !this.isRestoreSettling(now) || !this.anchor) return null
    this.initialRestoreIssued = true
    return copyAnchor(this.anchor)
  }

  /**
   * Checks the live viewport and requests a bounded correction when CodeMirror
   * has moved it after the initial restore. An unreadable viewport consumes no
   * retry, because measurement may simply not be ready yet.
   */
  verifyRestore(actual: VaultScrollAnchor | null, now: number): VaultScrollAnchor | null {
    if (!this.initialRestoreIssued || !this.isRestoreSettling(now) || !this.anchor || !actual) return null
    if (anchorsMatch(this.anchor, actual) || this.restoreRetries >= this.maxRetries) return null
    this.restoreRetries += 1
    return copyAnchor(this.anchor)
  }

  /** True only during the finite period in which automatic correction is allowed. */
  isRestoreSettling(now: number): boolean {
    return !this.userTookOver && this.restoreDeadline !== null && now < this.restoreDeadline
  }

  /** Milliseconds until correction must stop; useful for bounded scheduling. */
  restoreTimeRemaining(now: number): number {
    if (!this.isRestoreSettling(now) || this.restoreDeadline === null) return 0
    return this.restoreDeadline - now
  }

  /** Synthetic mount-time scrolls must not overwrite the remembered anchor. */
  canRemember(now: number): boolean {
    return !this.isRestoreSettling(now)
  }

  remember(anchor: VaultScrollAnchor): VaultScrollAnchor {
    this.anchor = copyAnchor(anchor)
    return copyAnchor(this.anchor)
  }

  /** The reader acted explicitly, so correction stops and persistence unlocks. */
  takeOver(): void {
    this.userTookOver = true
  }

  /** Anchor to persist when the editor is torn down by a tab switch. */
  anchorForTeardown(): VaultScrollAnchor | null {
    return this.anchor ? copyAnchor(this.anchor) : null
  }
}
