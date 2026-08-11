/**
 * Agent 发送请求的用户消息持久化策略。
 *
 * 只有真正开启的新一轮 Agent run 才能写入一条用户消息。被并发保护拒绝的请求
 * 与“重试上一条消息”都不是新的用户输入；若仍追加到 JSONL，会在停止/恢复竞态中
 * 产生多个相同的用户气泡。
 */
export function shouldPersistInitialUserMessage(options: {
  hasActiveRun: boolean
  retryOfErrorUuid?: string
}): boolean {
  return !options.hasActiveRun && !options.retryOfErrorUuid
}

export function getActiveRunRejectionMessage(): string {
  return '上一条消息仍在处理中；这条消息未保存。请等待本轮完全停止后再发送。'
}
