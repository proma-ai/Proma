export interface SessionRuntimeCleanupOperations {
  stopAgent: (sessionId: string) => void
  clearPermissionWhitelist: (sessionId: string) => void
  clearPermissionPending: (sessionId: string) => void
  clearAskUserPending: (sessionId: string) => void
  clearExitPlanPending: (sessionId: string) => void
  clearQueuedMessages: (sessionId: string) => void
  closeBrowser: (sessionId: string) => Promise<void>
  closeTerminals: (sessionId: string) => void
}

/**
 * 删除前统一回收运行时资源，不读写会话文件或项目目录。
 *
 * stop 必须在 clearQueuedMessages 前执行：stop 需要读取队列 dispatching 状态，
 * 才能取消尚未进入 activeSessions 的启动。两者之间不能 await，避免排队消息启动。
 * 在首次让出事件循环前清理全部目标的同步状态，再等待全部浏览器关闭。
 * 每项失败独立收集；全部目标均尝试后统一抛错，调用方不得继续持久化删除，
 * 从而保留会话/项目供重试（已停止的执行和已清空的队列不回滚）。
 */
export async function cleanupSessionRuntimes(
  sessionIds: readonly string[],
  operations: SessionRuntimeCleanupOperations,
): Promise<void> {
  const errors: Error[] = []
  const recordFailure = (sessionId: string, step: string, cause: unknown): void => {
    errors.push(new Error(`会话 ${sessionId} 的${step}清理失败`, { cause }))
  }
  const runSync = (sessionId: string, step: string, operation: (id: string) => void): void => {
    try {
      operation(sessionId)
    } catch (error) {
      recordFailure(sessionId, step, error)
    }
  }
  const uniqueSessionIds = [...new Set(sessionIds)]
  for (const sessionId of uniqueSessionIds) {
    runSync(sessionId, 'Agent 停止', operations.stopAgent)
    runSync(sessionId, '排队消息', operations.clearQueuedMessages)
    runSync(sessionId, '权限白名单', operations.clearPermissionWhitelist)
    runSync(sessionId, '权限请求', operations.clearPermissionPending)
    runSync(sessionId, 'AskUser 请求', operations.clearAskUserPending)
    runSync(sessionId, 'ExitPlan 请求', operations.clearExitPlanPending)
    runSync(sessionId, '终端', operations.closeTerminals)
  }

  await Promise.all(uniqueSessionIds.map(async (sessionId) => {
    try {
      await operations.closeBrowser(sessionId)
    } catch (error) {
      recordFailure(sessionId, '浏览器', error)
    }
  }))

  if (errors.length > 0) {
    throw new AggregateError(errors, `会话运行时清理未完成，未继续删除，请重试：${errors.map((error) => error.message).join('；')}`)
  }
}
