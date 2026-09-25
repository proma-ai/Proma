/**
 * Cloud 控制面网络 transport。
 *
 * 所有 Cloud API 请求在完整响应读取期间共享此 scope：代理 dispatcher 只能在
 * response body 消费完成后关闭，否则会中断 JSON/SSE body。
 */
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { createManagedProxyFetch } from './proxy-fetch'
import type { CloudFetchScope } from '@proma/cloud'

export const withCloudFetch: CloudFetchScope = async (work) => {
  const managed = createManagedProxyFetch(await getEffectiveProxyUrl())
  try {
    return await work(managed.fetch)
  } finally {
    await managed.close()
  }
}
