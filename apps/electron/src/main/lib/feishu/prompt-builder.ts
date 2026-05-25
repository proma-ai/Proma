/**
 * 飞书消息上下文 → Agent 系统提示词 + user message 的构造器。
 *
 * 解决的真实问题：
 *   1. Agent 看不到引用回复——用户在飞书里"长按 → 回复"某条消息时，
 *      飞书把被引用消息的 messageId 放在 message.parent_id 里。原来
 *      Proma 只把 user text 给 Agent，丢掉了"用户在问哪条消息"这个上下文。
 *   2. Agent 不知道 chat 类型与发送者——群聊 vs 私聊、用户名等元数据
 *      此前是隐式的（仅在群聊 prefix 里出现）。
 *   3. Agent 看不到被引用的卡片内容——用户引用 Bot 发的卡片提问时，
 *      只看到一串 "[card]" 占位文本。
 *
 * 借鉴 zara/feishu-claude-code-bridge `src/agent/claude/adapter.ts`
 * 的 BRIDGE_SYSTEM_PROMPT 约定 + `src/bot/quote.ts` 的引用消息抓取，
 * 但 Proma 用动态系统提示词构建，BRIDGE_SYSTEM_PROMPT 作为
 * AgentSendInput.userMessage 的前置 XML 块（不是 system prompt）。
 *
 * 约定的 XML 块（教 Agent 见 BRIDGE_USER_MESSAGE_PRELUDE）：
 *   <bridge_context>       chat_id / chat_type / sender 元数据
 *   <quoted_message>       被引用消息内容（含 merge_forward 展开）
 *   <interactive_card>     被引用消息是卡片时，注入完整 card JSON
 *   <attached_files>       本地附件列表（已有，由 handleUserMessage 构造）
 */

import type { Client as LarkClient } from '@larksuiteoapi/node-sdk'

/** 引用消息的简化结构，由 Bridge 调 im.message.get 拉取得到。 */
export interface QuotedMessage {
  messageId: string
  senderOpenId?: string
  senderName?: string
  createdAt?: number
  contentType: string
  /** 文本内容（已从飞书 content JSON 解出） */
  content: string
  /** 如果被引用消息本身是 interactive 卡片，这里是原 card JSON 字符串 */
  cardJson?: string
}

export interface BridgeContext {
  chatId: string
  chatType: 'p2p' | 'group' | 'topic'
  senderOpenId: string
  senderName?: string
  /** 话题群的 thread_id；普通群/p2p 留空 */
  threadId?: string
}

export interface BuildOptions {
  /** 用户原始文本（已合并多消息 batch 时由调用方拼好） */
  userText: string
  /** chat / sender 元数据 */
  context: BridgeContext
  /** 引用回复目标（用户长按"回复"指向的消息）；可选 */
  quoted?: QuotedMessage
  /** 附件路径引用块；handleUserMessage 已有逻辑构造，原样拼入 */
  attachedFilesBlock?: string
  /** 群聊额外注入：群名 / 成员列表 / 历史摘要 */
  groupExtraBlock?: string
}

/** 教 Agent 如何看待 bridge 注入的 XML 块。会被前置到每条 userMessage。 */
export const BRIDGE_USER_MESSAGE_PRELUDE = `<!-- 你正在通过 Proma 飞书桥处理来自飞书的用户消息。bridge 会用 XML 块注入
当前对话的元数据。下面这些 XML 块**对用户不可见**，不要照抄到回复里。

可能出现的 XML 块：
- <bridge_context>：chat_id / chat_type / sender 等飞书侧元数据
- <quoted_message>：用户长按"回复"指向的那条消息（你的回答应该围绕它展开）
- <interactive_card>：被引用消息是卡片时，附上原 card JSON 供你理解结构
- <attached_files>：用户上传的图片/文件已保存到本地，给你绝对路径

用户的实际问题在这些块之后。回答时围绕用户问题展开；XML 块只用来理解上下文。

【飞书桥重要约束】
1. **禁用 AskUserQuestion 工具**：飞书桥目前没有交互问答的 UI 通道，调用这个工具
   会让会话卡死。如果信息不足，请基于现有信息给出最佳推断（可在回复里说明你的
   假设），或直接告知用户需要的额外信息让他们补充，让用户在下一条消息里补全。
   绝对不要调用 AskUserQuestion。
2. **附件优先用 Read 工具读取**：<attached_files> 给的是已保存到本地的绝对路径，
   你可以直接 Read（图片走多模态读取）/ 用 Bash 的 file/cat 等命令查看。
3. **回复格式**：飞书侧使用 markdown 富文本卡片渲染，可以放心用 markdown 格式。
-->`

/**
 * 把上下文 / 引用 / 附件 / 用户文本组装成最终的 AgentSendInput.userMessage。
 *
 * 输出结构（自上而下）：
 *   BRIDGE_USER_MESSAGE_PRELUDE
 *   <bridge_context>...</bridge_context>
 *   <quoted_message>...</quoted_message>     // 仅当 quoted 存在
 *   <interactive_card>...</interactive_card> // 仅当被引用消息是卡片
 *   <attached_files>...</attached_files>     // 仅当有附件
 *   <group_extra>...</group_extra>           // 仅当群聊（群名/成员/历史）
 *   <user_message>用户文本</user_message>
 */
export function buildAgentUserMessage(opts: BuildOptions): string {
  const parts: string[] = [BRIDGE_USER_MESSAGE_PRELUDE]

  parts.push(buildBridgeContextBlock(opts.context))

  if (opts.quoted) {
    parts.push(buildQuotedMessageBlock(opts.quoted))
    if (opts.quoted.cardJson) {
      parts.push(buildInteractiveCardBlock(opts.quoted.cardJson))
    }
  }

  if (opts.attachedFilesBlock && opts.attachedFilesBlock.trim()) {
    parts.push(opts.attachedFilesBlock.trim())
  }

  if (opts.groupExtraBlock && opts.groupExtraBlock.trim()) {
    parts.push(`<group_extra>\n${opts.groupExtraBlock.trim()}\n</group_extra>`)
  }

  parts.push(`<user_message>\n${opts.userText}\n</user_message>`)

  return parts.join('\n\n')
}

function buildBridgeContextBlock(ctx: BridgeContext): string {
  const lines = [
    `chat_id: ${ctx.chatId}`,
    `chat_type: ${ctx.chatType}`,
    `sender_id: ${ctx.senderOpenId}`,
  ]
  if (ctx.senderName) lines.push(`sender_name: ${ctx.senderName}`)
  if (ctx.threadId) lines.push(`thread_id: ${ctx.threadId}`)
  return `<bridge_context>\n${lines.join('\n')}\n</bridge_context>`
}

function buildQuotedMessageBlock(q: QuotedMessage): string {
  const attrs = [
    `id="${q.messageId}"`,
    q.senderOpenId ? `sender_id="${q.senderOpenId}"` : '',
    q.senderName ? `sender_name="${escapeAttr(q.senderName)}"` : '',
    q.createdAt ? `created_at="${new Date(q.createdAt).toISOString()}"` : '',
    `type="${q.contentType}"`,
  ].filter(Boolean).join(' ')
  return `<quoted_message ${attrs}>\n${q.content}\n</quoted_message>`
}

function buildInteractiveCardBlock(cardJson: string): string {
  return `<interactive_card>\n${cardJson}\n</interactive_card>`
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
}

/**
 * 从飞书 im.message.get 拿到被引消息的 raw 字段后，转换成 QuotedMessage。
 * 调用方应处理网络错误并返回 undefined，让 prompt 不带 quoted 块即可。
 */
export async function fetchQuotedMessage(
  client: LarkClient,
  parentMessageId: string,
): Promise<QuotedMessage | undefined> {
  try {
    const resp = await client.im.v1.message.get({
      path: { message_id: parentMessageId },
    })
    const item = resp.data?.items?.[0]
    if (!item) return undefined

    const contentType = item.msg_type ?? 'unknown'
    const bodyContent = item.body?.content ?? ''
    const senderId = item.sender?.id
    const createTime = typeof item.create_time === 'string'
      ? Number(item.create_time)
      : item.create_time

    let content = ''
    let cardJson: string | undefined

    if (contentType === 'text') {
      content = safeJsonField(bodyContent, 'text') ?? bodyContent
    } else if (contentType === 'post') {
      // post 是富文本，飞书内容是 { title, content: [[{tag, text|content}]] }
      // 简化：拼接所有 text 段
      content = extractPostText(bodyContent)
    } else if (contentType === 'interactive') {
      content = '（被引用的是交互式卡片，详见 <interactive_card>）'
      cardJson = bodyContent
    } else if (contentType === 'image') {
      content = `（被引用的是图片消息，image_key=${safeJsonField(bodyContent, 'image_key') ?? '?'}）`
    } else if (contentType === 'file') {
      content = `（被引用的是文件消息，file_name=${safeJsonField(bodyContent, 'file_name') ?? '?'}）`
    } else {
      // 兜底：原始 JSON 截断
      content = bodyContent.length > 500 ? bodyContent.slice(0, 500) + '…' : bodyContent
    }

    return {
      messageId: parentMessageId,
      senderOpenId: senderId,
      createdAt: typeof createTime === 'number' ? createTime : undefined,
      contentType,
      content,
      cardJson,
    }
  } catch (err) {
    console.warn('[飞书 PromptBuilder] 拉取被引消息失败', {
      parentMessageId,
      err: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

function safeJsonField(bodyContent: string, field: string): string | undefined {
  try {
    const obj = JSON.parse(bodyContent) as Record<string, unknown>
    const v = obj[field]
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

interface PostNode {
  tag?: string
  text?: string
  content?: string
}

function extractPostText(bodyContent: string): string {
  try {
    const obj = JSON.parse(bodyContent) as {
      title?: string
      content?: PostNode[][]
    }
    const lines: string[] = []
    if (obj.title) lines.push(obj.title)
    if (Array.isArray(obj.content)) {
      for (const line of obj.content) {
        if (!Array.isArray(line)) continue
        const seg = line.map((n) => n.text ?? n.content ?? '').join('')
        if (seg) lines.push(seg)
      }
    }
    return lines.join('\n')
  } catch {
    return bodyContent
  }
}
