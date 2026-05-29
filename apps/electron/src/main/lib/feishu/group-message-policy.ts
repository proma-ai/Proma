import type {
  FeishuChatBinding,
  FeishuGroupInfo,
} from '@proma/shared'

export interface SingleUserGroupInput {
  groupInfo: Pick<FeishuGroupInfo, 'members'> | null | undefined
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

export function isSingleUserGroupForSender(input: SingleUserGroupInput): boolean {
  const members = (input.groupInfo?.members ?? [])
    .filter((member) => member.openId !== input.botOpenId)
  if (members.length !== 1) return false

  const [onlyUser] = members
  if (!onlyUser || onlyUser.openId !== input.senderOpenId) return false

  const bindingUserId = input.binding?.userId
  if (bindingUserId && bindingUserId !== 'unknown' && bindingUserId !== input.senderOpenId) {
    return false
  }

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
