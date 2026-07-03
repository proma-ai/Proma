import type { SDKSystemMessage } from '../types/agent'

export type SDKCompactStatus = 'compacting' | 'success' | 'failed'

export function getSDKCompactStatus(message: SDKSystemMessage): SDKCompactStatus | undefined {
  if (message.subtype === 'compact_boundary') return 'success'
  if (message.subtype === 'compacting') return 'compacting'

  if (message.subtype !== 'status') return undefined
  if (message.compact_result === 'success' || message.compact_result === 'failed') {
    return message.compact_result
  }
  if (message.status === 'compacting') return 'compacting'
  if (typeof message.compact_error === 'string' && message.compact_error.trim().length > 0) {
    return 'failed'
  }
  return undefined
}

export function isPersistableSDKSystemMessage(message: SDKSystemMessage): boolean {
  return message.subtype === 'permission_denied' || getSDKCompactStatus(message) != null
}
