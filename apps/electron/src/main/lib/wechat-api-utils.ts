/** iLink 的成功回执允许省略 ret（官方 SendMessageResp.ret 为可选字段）。 */
export function assertWeChatSendSucceeded(response: unknown): void {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('微信 sendmessage 响应格式无效')
  }
  const data = response as Record<string, unknown>
  for (const key of ['ret', 'errcode']) {
    const code = data[key]
    if (code === undefined) continue
    if (typeof code !== 'number' || !Number.isInteger(code)) {
      throw new Error(`微信 sendmessage ${key} 格式无效`)
    }
    if (code !== 0) {
      throw new Error(`微信 sendmessage 失败: ${key}=${code}`)
    }
  }
}
