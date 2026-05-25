import type * as lark from '@larksuiteoapi/node-sdk'

/**
 * CardKit 2.0 流式卡片：创建一次、按 sequence 增量 update 多次。
 *
 * 设计参考 zara/feishu-claude-code-bridge `src/card/managed.ts`，但
 * 集成了节流（避免高频更新撞飞书 API 限流）和强制 flush（终态时立刻
 * 发送最终态，不被节流推迟）。
 *
 * 用法：
 *   const stream = await CardStream.open(client, chatId, initialCard)
 *   await stream.update(card1)
 *   await stream.update(card2)
 *   await stream.flush(finalCard)   // 终态强制立刻刷
 */

const THROTTLE_MS = 400
const MAX_UPDATE_RETRIES = 2

export class CardStream {
  private constructor(
    private readonly client: lark.Client,
    private readonly cardId: string,
    public readonly messageId: string,
    public readonly chatId: string,
  ) {}

  private sequence = 1
  private pendingCard: object | null = null
  private pendingTimer: NodeJS.Timeout | null = null
  private inFlight: Promise<void> | null = null
  private closed = false

  /**
   * 创建 CardKit 2.0 卡片实例 + 把它作为 message 发到指定 chat。
   * 返回的 CardStream 持有 card_id 和 message_id，后续可继续 update。
   */
  static async open(
    client: lark.Client,
    chatId: string,
    initialCard: object,
    opts: { replyToMessageId?: string; replyInThread?: boolean } = {},
  ): Promise<CardStream> {
    const created = await client.cardkit.v1.card.create({
      data: { type: 'card_json', data: JSON.stringify(initialCard) },
    })
    const cardId = created.data?.card_id
    if (!cardId) {
      throw new Error(`cardkit.card.create 未返回 card_id: ${JSON.stringify(created).slice(0, 200)}`)
    }

    const content = JSON.stringify({ type: 'card', data: { card_id: cardId } })
    let messageId: string | undefined

    if (opts.replyToMessageId) {
      const sent = await client.im.message.reply({
        path: { message_id: opts.replyToMessageId },
        data: {
          msg_type: 'interactive',
          content,
          ...(opts.replyInThread ? { reply_in_thread: true } : {}),
        },
      })
      messageId = sent.data?.message_id
    } else {
      const sent = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'interactive', content },
      })
      messageId = sent.data?.message_id
    }

    if (!messageId) {
      throw new Error('发送 card 消息未返回 message_id')
    }

    return new CardStream(client, cardId, messageId, chatId)
  }

  /**
   * 排队一次更新。同步返回，实际请求会在 THROTTLE_MS 后合并发送。
   * 终态时建议调 flush() 强制立刻发送。
   */
  update(card: object): void {
    if (this.closed) return
    this.pendingCard = card
    this.scheduleFlush()
  }

  /**
   * 立刻刷新到最新 pending 卡片，等待网络返回。终态必调。
   */
  async flush(card?: object): Promise<void> {
    if (this.closed) return
    if (card) this.pendingCard = card
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    await this.drain()
  }

  /**
   * 关闭：禁止后续 update，等 in-flight 请求结束。
   */
  async close(): Promise<void> {
    this.closed = true
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => {})
    }
  }

  private scheduleFlush(): void {
    // inFlight 期间不重复设 timer：drain 的 finally 会在请求结束时
    // 检测 pendingCard 并重新触发，保证"最后一个胜出"语义不会丢消息
    if (this.pendingTimer || this.inFlight) return
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      void this.drain()
    }, THROTTLE_MS)
  }

  private async drain(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight.catch(() => {})
    }
    if (!this.pendingCard || this.closed) return

    const card = this.pendingCard
    this.pendingCard = null
    const seq = this.sequence++

    this.inFlight = this.sendUpdate(card, seq).finally(() => {
      this.inFlight = null
      // 若节流期间又积累了新卡，触发下一轮
      if (this.pendingCard && !this.closed) {
        this.scheduleFlush()
      }
    })
    await this.inFlight
  }

  private async sendUpdate(card: object, sequence: number): Promise<void> {
    let attempt = 0
    while (true) {
      try {
        await this.client.cardkit.v1.card.update({
          path: { card_id: this.cardId },
          data: {
            card: { type: 'card_json', data: JSON.stringify(card) },
            sequence,
          },
        })
        return
      } catch (err) {
        attempt++
        if (attempt > MAX_UPDATE_RETRIES) {
          console.error('[飞书] cardkit.card.update 失败（已达最大重试）', {
            cardId: this.cardId,
            sequence,
            err: err instanceof Error ? err.message : String(err),
          })
          return
        }
        // 飞书 API 限流时退避后重试
        await new Promise((r) => setTimeout(r, 200 * attempt))
      }
    }
  }
}
