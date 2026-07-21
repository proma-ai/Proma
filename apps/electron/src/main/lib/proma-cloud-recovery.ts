import type { ErrorCode, RecoveryAction } from '@proma/shared'

export const PROMA_CLOUD_RECOVERY_MODEL = 'gpt-5.6-terra'

const ELIGIBLE_ERROR_CODES = new Set<ErrorCode>([
  'invalid_api_key',
  'invalid_credentials',
  'expired_oauth_token',
  'token_expired',
  'billing_error',
  'rate_limited',
])

export function getPromaCloudRecoveryAction(
  provider: string | undefined,
  errorCode: ErrorCode,
): RecoveryAction | undefined {
  if (provider === 'proma' || !ELIGIBLE_ERROR_CODES.has(errorCode)) return undefined

  return {
    key: 'p',
    label: '使用 Proma Cloud 重试',
    action: 'switch_to_proma_cloud',
  }
}
