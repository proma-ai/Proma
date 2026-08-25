import { PROVIDER_DEFAULT_URLS, type Channel } from '@proma/shared'
import { normalizeBaseUrl } from '@proma/core'

const LEGACY_CODING_PLAN_OPENAI_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const LEGACY_AGENT_PLAN_ANTHROPIC_URL = 'https://ark.cn-beijing.volces.com/api/coding'

/**
 * 将火山方舟套餐渠道的历史官方端点规范到当前官方端点。
 *
 * 仅匹配火山方舟官方域名及已知历史路径；自定义地址不会被放行或改写。
 */
export function migrateVolcengineOfficialEndpoint(channel: Channel): Channel {
  if (channel.provider === 'doubao'
    && normalizeBaseUrl(channel.baseUrl) === normalizeBaseUrl(LEGACY_CODING_PLAN_OPENAI_URL)) {
    return { ...channel, baseUrl: PROVIDER_DEFAULT_URLS.doubao }
  }

  if (channel.provider === 'ark-coding-plan'
    && normalizeBaseUrl(channel.baseUrl) === normalizeBaseUrl(LEGACY_AGENT_PLAN_ANTHROPIC_URL)) {
    return { ...channel, baseUrl: PROVIDER_DEFAULT_URLS['ark-coding-plan'] }
  }

  return channel
}
