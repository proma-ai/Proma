import { extractZhipuCodingTeamApiToken, type ProviderType } from '@proma/shared'

export function usesAgentSdkBearerWithUserAgent(provider: ProviderType): boolean {
  return provider === 'kimi-coding'
    || provider === 'zhipu-coding'
    || provider === 'zhipu-coding-team'
    || provider === 'xiaomi-token-plan'
    || provider === 'qwen-token-plan'
}

export function applyAgentSdkAuthEnv(
  target: Record<string, string | undefined>,
  provider: ProviderType,
  apiKey: string,
  userAgent: string,
): void {
  if (usesAgentSdkBearerWithUserAgent(provider)) {
    target.ANTHROPIC_AUTH_TOKEN = provider === 'zhipu-coding-team'
      ? extractZhipuCodingTeamApiToken(apiKey)
      : apiKey
    target.ANTHROPIC_CUSTOM_HEADERS = `User-Agent: ${userAgent}`
    return
  }

  if (provider === 'minimax') {
    target.ANTHROPIC_AUTH_TOKEN = apiKey
    return
  }

  target.ANTHROPIC_API_KEY = apiKey
}
