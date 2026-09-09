import type {
  AgentSessionMeta,
  DeleteDelegatedSessionItemResult,
  DeleteDelegatedSessionsInput,
  DeleteDelegatedSessionsResult,
} from '@proma/shared'
import type { DeleteAgentSessionsResult } from './agent-session-manager'

export interface AgentSessionDeleteDependencies {
  listSessions: () => AgentSessionMeta[]
  isBusy: (sessionId: string) => boolean
  teardown: (sessionId: string) => Promise<void>
  deleteRecords: (sessionIds: readonly string[]) => Promise<DeleteAgentSessionsResult>
  afterDelete: (session: AgentSessionMeta) => void
}

const MAX_BATCH_SIZE = 100

function validateInput(input: DeleteDelegatedSessionsInput): string[] {
  const parentSessionId = input.parentSessionId?.trim()
  if (!parentSessionId) throw new Error('父会话 ID 不能为空')
  if (!Array.isArray(input.sessionIds) || input.sessionIds.length === 0) {
    throw new Error('至少选择一个子会话')
  }

  const requestedIds = [...new Set(input.sessionIds.map((id) => id?.trim()).filter(Boolean))]
  if (requestedIds.length === 0) throw new Error('子会话 ID 不能为空')
  if (requestedIds.length > MAX_BATCH_SIZE) throw new Error(`单次最多删除 ${MAX_BATCH_SIZE} 个子会话`)
  return requestedIds
}

function failure(sessionId: string, code: DeleteDelegatedSessionItemResult['code'], message: string): DeleteDelegatedSessionItemResult {
  return { sessionId, code, message }
}

/**
 * 删除指定父会话下明确选中的直接委派子会话。
 * metadata 批量提交由 deleteRecords 保证；外围 teardown/cleanup 逐项返回真实结果。
 */
export async function deleteDelegatedSessions(
  input: DeleteDelegatedSessionsInput,
  dependencies: AgentSessionDeleteDependencies,
): Promise<DeleteDelegatedSessionsResult> {
  const requestedIds = validateInput(input)
  const parentSessionId = input.parentSessionId.trim()
  const allSessions = dependencies.listSessions()
  const sessionsById = new Map(allSessions.map((session) => [session.id, session] as const))
  const delegatedParentIds = new Set(allSessions
    .filter((session) => !!session.parentSessionId && !!session.sourceDelegationId)
    .map((session) => session.parentSessionId!))
  const itemById = new Map<string, DeleteDelegatedSessionItemResult>()
  const eligibleIds: string[] = []

  for (const sessionId of requestedIds) {
    const session = sessionsById.get(sessionId)
    if (!session) {
      itemById.set(sessionId, failure(sessionId, 'not_found', '子会话不存在'))
    } else if (!session.sourceDelegationId) {
      itemById.set(sessionId, failure(sessionId, 'not_delegated_child', '该会话不是协作委派子会话'))
    } else if (session.parentSessionId !== parentSessionId) {
      itemById.set(sessionId, failure(sessionId, 'wrong_parent', '子会话不属于指定父会话'))
    } else if (delegatedParentIds.has(sessionId)) {
      itemById.set(sessionId, failure(sessionId, 'failed', '该子会话仍有委派后代，不能仅删除当前节点'))
    } else if (dependencies.isBusy(sessionId)) {
      itemById.set(sessionId, failure(sessionId, 'busy', '子会话正在启动、运行、等待处理或仍有排队消息'))
    } else {
      eligibleIds.push(sessionId)
    }
  }

  const preparedIds: string[] = []
  for (const sessionId of eligibleIds) {
    try {
      await dependencies.teardown(sessionId)
      if (dependencies.isBusy(sessionId)) {
        itemById.set(sessionId, failure(sessionId, 'busy', '子会话状态已变化，请停止后重试'))
      } else {
        preparedIds.push(sessionId)
      }
    } catch (error) {
      itemById.set(sessionId, failure(
        sessionId,
        'failed',
        `关闭子会话资源失败: ${error instanceof Error ? error.message : String(error)}`,
      ))
    }
  }

  // 所有异步 teardown 完成后统一重检，避免较早准备好的会话在等待后续 teardown 时重新启动。
  // deleteRecords() 在首个 await 前同步提交 metadata；提交前不得插入 await。
  const latestSessions = dependencies.listSessions()
  const latestSessionsById = new Map(latestSessions.map((session) => [session.id, session] as const))
  const latestDelegatedParentIds = new Set(latestSessions
    .filter((session) => !!session.parentSessionId && !!session.sourceDelegationId)
    .map((session) => session.parentSessionId!))
  const commitIds: string[] = []
  for (const sessionId of preparedIds) {
    const session = latestSessionsById.get(sessionId)
    if (!session) {
      itemById.set(sessionId, failure(sessionId, 'not_found', '子会话在提交删除前已不存在'))
    } else if (!session.sourceDelegationId) {
      itemById.set(sessionId, failure(sessionId, 'not_delegated_child', '会话已不再是协作委派子会话'))
    } else if (session.parentSessionId !== parentSessionId) {
      itemById.set(sessionId, failure(sessionId, 'wrong_parent', '子会话的父级已变化'))
    } else if (latestDelegatedParentIds.has(sessionId)) {
      itemById.set(sessionId, failure(sessionId, 'failed', '该子会话新增了委派后代，不能仅删除当前节点'))
    } else if (dependencies.isBusy(sessionId)) {
      itemById.set(sessionId, failure(sessionId, 'busy', '子会话状态已变化，请停止后重试'))
    } else {
      commitIds.push(sessionId)
    }
  }

  if (commitIds.length > 0) {
    try {
      // deleteRecords() 会先同步提交 metadata，再异步、限并发清理外围文件；
      // 因此这里的 await 不会在 metadata 原子提交前打开 TOCTOU 窗口。
      const deletion = await dependencies.deleteRecords(commitIds)
      const deletedById = new Map(deletion.deleted.map((item) => [item.session.id, item] as const))
      const missingAfterPreflight = new Set(deletion.notFoundIds)

      for (const sessionId of commitIds) {
        const deleted = deletedById.get(sessionId)
        if (!deleted) {
          itemById.set(sessionId, missingAfterPreflight.has(sessionId)
            ? failure(sessionId, 'not_found', '子会话在提交删除前已不存在')
            : failure(sessionId, 'failed', '子会话索引未返回删除结果'))
          continue
        }

        const warnings = [...deleted.warnings]
        try {
          dependencies.afterDelete(deleted.session)
        } catch (error) {
          warnings.push(`清理会话运行时状态失败: ${error instanceof Error ? error.message : String(error)}`)
        }
        itemById.set(sessionId, {
          sessionId,
          code: 'deleted',
          ...(warnings.length > 0 ? { warnings } : {}),
        })
      }
    } catch (error) {
      const message = `提交批量删除失败: ${error instanceof Error ? error.message : String(error)}`
      for (const sessionId of commitIds) itemById.set(sessionId, failure(sessionId, 'failed', message))
    }
  }

  const items = requestedIds.map((sessionId) => itemById.get(sessionId)
    ?? failure(sessionId, 'failed', '未生成删除结果'))

  return {
    parentSessionId,
    requestedIds,
    deletedIds: items.filter((item) => item.code === 'deleted').map((item) => item.sessionId),
    items,
  }
}
