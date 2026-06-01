import type {
  FeishuChatBinding,
  FeishuGroupInfo,
} from '@proma/shared'

export interface SingleUserGroupInput {
  groupInfo: Pick<FeishuGroupInfo, 'members' | 'userCount'> | null | undefined
  senderOpenId: string
  botOpenId?: string | null
  binding?: Pick<FeishuChatBinding, 'userId'> | null
}

export interface GroupMessageAccessInput extends SingleUserGroupInput {
  isSessionMirrorGroup: boolean
  isBotMentioned: boolean
}

export interface GroupMessageAccessResult {
  accepted: boolean
  reason: 'session-mirror' | 'bot-mentioned' | 'single-user-group' | 'needs-mention'
}

/**
 * 判定「群里只有 bot + 一个真人」，用于免 @ 续聊。
 *
 * 优先用 chat.get 返回的 user_count（飞书侧权威的真人数量，不含机器人）——
 * 这甩掉了对 botOpenId 是否已拿到、以及成员列表读取权限的依赖。
 * 仅当 user_count 不可用（旧缓存或 chat.get 失败）时，回退到「数成员列表减 bot」。
 *
 * 注意：加人后 user_count 自动 ≥2，会回到「必须 @」，符合
 * 「只有 2 人群免 @，多人群谁都要 @（含建群者）」的预期。
 */
export function isSingleUserGroupForSender(input: SingleUserGroupInput): boolean {
  const bindingUserId = input.binding?.userId
  const bindingMismatch =
    !!bindingUserId && bindingUserId !== 'unknown' && bindingUserId !== input.senderOpenId
  if (bindingMismatch) return false

  // 主路径：user_count 权威判定（恰好 1 个真人）
  const userCount = input.groupInfo?.userCount
  if (typeof userCount === 'number') {
    return userCount === 1
  }

  // 回退路径：成员列表减 bot（依赖成员读取权限 + botOpenId 正确）
  const members = (input.groupInfo?.members ?? [])
    .filter((member) => member.openId !== input.botOpenId)
  if (members.length !== 1) return false

  const [onlyUser] = members
  if (!onlyUser || onlyUser.openId !== input.senderOpenId) return false

  return true
}

export function resolveGroupMessageAccess(input: GroupMessageAccessInput): GroupMessageAccessResult {
  if (input.isSessionMirrorGroup) {
    return { accepted: true, reason: 'session-mirror' }
  }

  if (input.isBotMentioned) {
    return { accepted: true, reason: 'bot-mentioned' }
  }

  if (isSingleUserGroupForSender(input)) {
    return { accepted: true, reason: 'single-user-group' }
  }

  return { accepted: false, reason: 'needs-mention' }
}
