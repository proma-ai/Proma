import type { VaultReadResult } from '@proma/shared'

export type VaultDocumentWriteRequest = {
  relativePath: string
  content: string
  expectedSha256: string
}

export type VaultDocumentWriteResult =
  | { ok: true; relativePath: string; sha256: string; modifiedAt: number }
  | { ok: false; reason: 'conflict' | 'error'; message?: string }

export type VaultDocumentSnapshot = {
  base: VaultReadResult
  draft: string
  saving: boolean
  conflict: boolean
  remoteConflict: VaultReadResult | null
}

export type VaultDocumentRemoteDisposition = 'ignored' | 'adopted' | 'conflict'

type Listener = () => void
type Write = (request: VaultDocumentWriteRequest) => Promise<VaultDocumentWriteResult>

/**
 * A per-file, renderer-local document model. Every Vault view that opens the
 * same note sees one draft and one optimistic-write queue instead of competing
 * React-local drafts. The main-process SHA CAS remains the final guard against
 * writes from Obsidian or an Agent outside this renderer.
 */
export class VaultDocumentController {
  private snapshot: VaultDocumentSnapshot
  private readonly listeners = new Set<Listener>()
  private savePromise: Promise<VaultDocumentWriteResult> | null = null

  constructor(
    initial: VaultReadResult,
    private readonly disposeWhenClean?: () => void,
  ) {
    this.snapshot = {
      base: initial,
      draft: initial.content,
      saving: false,
      conflict: false,
      remoteConflict: null,
    }
  }

  getSnapshot = (): VaultDocumentSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      this.disposeIfUnobservedAndClean()
    }
  }

  setDraft(draft: string): void {
    if (draft === this.snapshot.draft) return
    this.snapshot = { ...this.snapshot, draft }
    this.emit()
  }

  /** Incorporate a disk read without allowing an older poll to roll state back. */
  observeRemote(next: VaultReadResult): VaultDocumentRemoteDisposition {
    const { base, draft } = this.snapshot
    if (next.sha256 === base.sha256 || next.modifiedAt < base.modifiedAt) return 'ignored'

    if (draft === base.content || draft === next.content) {
      this.snapshot = {
        base: next,
        draft: next.content,
        saving: this.snapshot.saving,
        conflict: false,
        remoteConflict: null,
      }
      this.emit()
      return 'adopted'
    }

    const alreadyConflicted = this.snapshot.conflict
      && this.snapshot.remoteConflict?.sha256 === next.sha256
    this.snapshot = { ...this.snapshot, conflict: true, remoteConflict: next }
    this.emit()
    return alreadyConflicted ? 'ignored' : 'conflict'
  }

  discardLocalDraft(): void {
    // A CAS failure does not include remote content; reset to our last known
    // base and let the caller's fresh read adopt the actual disk revision.
    const remote = this.snapshot.remoteConflict ?? this.snapshot.base
    this.snapshot = {
      base: remote,
      draft: remote.content,
      saving: false,
      conflict: false,
      remoteConflict: null,
    }
    this.emit()
  }

  async flush(write: Write): Promise<VaultDocumentWriteResult> {
    if (this.snapshot.conflict) return { ok: false, reason: 'conflict' }
    if (this.savePromise) return this.savePromise

    const pending = (async (): Promise<VaultDocumentWriteResult> => {
      let lastResult: VaultDocumentWriteResult = {
        ok: true,
        relativePath: this.snapshot.base.relativePath,
        sha256: this.snapshot.base.sha256,
        modifiedAt: this.snapshot.base.modifiedAt,
      }
      while (this.snapshot.draft !== this.snapshot.base.content) {
        const content = this.snapshot.draft
        const base = this.snapshot.base
        this.snapshot = { ...this.snapshot, saving: true }
        this.emit()
        const result = await write({
          relativePath: base.relativePath,
          content,
          expectedSha256: base.sha256,
        })
        if (!result.ok) {
          this.snapshot = {
            ...this.snapshot,
            saving: false,
            conflict: true,
            remoteConflict: this.snapshot.remoteConflict,
          }
          this.emit()
          return result
        }

        // Retain edits made while this write was in flight; the next iteration
        // writes that newer generation against the returned SHA.
        this.snapshot = {
          ...this.snapshot,
          base: {
            relativePath: result.relativePath,
            content,
            sha256: result.sha256,
            modifiedAt: result.modifiedAt,
          },
          saving: false,
        }
        this.emit()
        lastResult = result
      }
      return lastResult
    })()
    this.savePromise = pending
    try {
      return await pending
    } finally {
      if (this.savePromise === pending) this.savePromise = null
      this.disposeIfUnobservedAndClean()
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private disposeIfUnobservedAndClean(): void {
    if (this.listeners.size === 0 && !this.savePromise && !this.snapshot.saving && !this.snapshot.conflict && this.snapshot.draft === this.snapshot.base.content) {
      this.disposeWhenClean?.()
    }
  }
}

const controllers = new Map<string, VaultDocumentController>()

export function getVaultDocumentController(initial: VaultReadResult, vaultScope: string): VaultDocumentController {
  const key = `${vaultScope}:${initial.relativePath}`
  const existing = controllers.get(key)
  if (existing) return existing
  const controller = new VaultDocumentController(initial, () => {
    if (controllers.get(key) === controller) controllers.delete(key)
  })
  controllers.set(key, controller)
  return controller
}
