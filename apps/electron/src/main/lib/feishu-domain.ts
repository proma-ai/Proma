import type { FeishuDomain } from '@proma/shared'

export const DEFAULT_FEISHU_DOMAIN: FeishuDomain = 'feishu'

export function normalizeFeishuDomain(domain: FeishuDomain | undefined): FeishuDomain {
  return domain === 'lark' ? 'lark' : DEFAULT_FEISHU_DOMAIN
}

export function getFeishuApiBaseUrl(domain: FeishuDomain | undefined): string {
  return normalizeFeishuDomain(domain) === 'lark'
    ? 'https://open.larksuite.com'
    : 'https://open.feishu.cn'
}
