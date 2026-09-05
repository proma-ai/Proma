import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file'

export type SlackDeliveryStatus = 'accepted' | 'running' | 'final-ready' | 'delivered' | 'consumed' | 'failed'

export interface SlackDeliveryRecord {
  eventId: string
  status: SlackDeliveryStatus
  sessionId?: string
  channelId: string
  threadTs: string
  responseTs?: string
  /** Stable Slack idempotency key for a terminal post without a response placeholder. */
  clientMessageId?: string
  finalText?: string
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

interface SlackDeliveryFile {
  version: 1
  records: SlackDeliveryRecord[]
}

const MAX_RECORDS = 400
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_FINAL_TEXT = 40_000

/**
 * Durable event de-duplication and delivery obligation ledger.
 * State is deliberately small, bounded and atomically persisted so a process
 * crash between Agent completion and Slack postMessage does not become silent loss.
 */
export class SlackDeliveryStore {
  private records = new Map<string, SlackDeliveryRecord>()

  constructor(private readonly filePath: string) {
    const parsed = readJsonFileSafe<SlackDeliveryFile>(filePath)
    if (parsed?.version === 1 && Array.isArray(parsed.records)) {
      let removedLegacyDirectRecord = false
      for (const record of parsed.records) {
        if (!isRecord(record)) continue
        // Older versions used `im` as a synthetic thread timestamp for direct messages.
        if (record.threadTs === 'im' || record.channelId.startsWith('D')) {
          removedLegacyDirectRecord = true
          continue
        }
        this.records.set(record.eventId, record)
      }
      this.prune(false)
      if (removedLegacyDirectRecord) this.persist()
    }
  }

  get(eventId: string): SlackDeliveryRecord | undefined {
    return this.records.get(eventId)
  }

  accept(input: Pick<SlackDeliveryRecord, 'eventId' | 'channelId' | 'threadTs'>): SlackDeliveryRecord {
    const existing = this.records.get(input.eventId)
    if (existing) return existing
    const now = Date.now()
    const record: SlackDeliveryRecord = { ...input, status: 'accepted', createdAt: now, updatedAt: now }
    this.records.set(record.eventId, record)
    this.persist()
    return record
  }

  update(eventId: string, updates: Partial<Omit<SlackDeliveryRecord, 'eventId' | 'createdAt'>>): SlackDeliveryRecord | undefined {
    const record = this.records.get(eventId)
    if (!record) return undefined
    Object.assign(record, updates, { updatedAt: Date.now() })
    if (record.finalText && record.finalText.length > MAX_FINAL_TEXT) {
      record.finalText = record.finalText.slice(0, MAX_FINAL_TEXT)
    }
    this.persist()
    return record
  }

  /**
   * A final reply remains an obligation until it was actually accepted by Slack.
   * Legacy `failed` records are included so an upgrade repairs prior gaps too.
   */
  pendingFinalDeliveries(): SlackDeliveryRecord[] {
    return [...this.records.values()].filter((record) => record.status === 'final-ready' || record.status === 'failed')
  }

  /**
   * Socket Mode ACKs inbound events before the local Agent completes. A restart
   * cannot safely resume those Agent runs, so callers must post an interruption
   * notice rather than leave the originating Slack thread without an outcome.
   */
  interruptedRuns(): SlackDeliveryRecord[] {
    return [...this.records.values()].filter((record) => record.status === 'accepted' || record.status === 'running')
  }

  private prune(persist = true): void {
    const oldest = Date.now() - MAX_AGE_MS
    const candidates = [...this.records.values()]
      .filter((record) => record.updatedAt >= oldest)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECORDS)
    this.records = new Map(candidates.map((record) => [record.eventId, record]))
    if (persist) this.persist()
  }

  private persist(): void {
    this.prune(false)
    writeJsonFileAtomic(this.filePath, {
      version: 1,
      records: [...this.records.values()].sort((a, b) => a.updatedAt - b.updatedAt),
    } satisfies SlackDeliveryFile)
  }
}

function isRecord(value: unknown): value is SlackDeliveryRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SlackDeliveryRecord>
  return typeof record.eventId === 'string'
    && typeof record.status === 'string'
    && typeof record.channelId === 'string'
    && typeof record.threadTs === 'string'
    && typeof record.createdAt === 'number'
    && typeof record.updatedAt === 'number'
}
