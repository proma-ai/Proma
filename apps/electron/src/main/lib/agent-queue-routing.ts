/**
 * Pi runtime 完成 query 与 renderer 收到终态事件之间，可能拒绝对旧通道的消息注入。
 * 这些错误表示消息尚未被接受，应转交 deferred queue，而不是暴露为用户发送失败。
 */
export function isStaleActiveQueueError(error: unknown): boolean {
  const record = error !== null && typeof error === 'object'
    ? error as Record<string, unknown>
    : undefined
  const code = typeof record?.code === 'string' ? record.code : ''
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string'
      ? record.message
      : String(error)

  return code === 'agent.query.not_active' ||
    message.includes('会话未运行，无法追加消息') ||
    message.includes('无活跃消息通道可注入队列消息') ||
    message.includes('当前会话没有正在运行的 Agent') ||
    message.includes('Agent session is not active')
}
