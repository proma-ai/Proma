/** Cloud 控制面请求：完整 deadline、安全错误及脱敏诊断。不改变代理策略。 */
export type CloudFailureKind = 'network' | 'timeout' | 'server' | 'rate_limited' | 'auth' | 'client' | 'unknown'
export interface ApiError {
  status: number
  message: string
  kind: CloudFailureKind
  retryable: boolean
}

export function getSafeCloudFailureMessage(kind: CloudFailureKind): string {
  switch (kind) {
    case 'network': return '无法连接 Proma Cloud，请检查网络后重试'
    case 'timeout': return '连接 Proma Cloud 超时，请稍后重试'
    case 'server': return 'Proma Cloud 暂时不可用，请稍后重试'
    case 'rate_limited': return '请求过于频繁，请稍后重试'
    case 'auth': return '认证已过期，请重新登录'
    case 'client': return '请求未能完成，请检查输入后重试'
    default: return '请求失败，请稍后重试'
  }
}

export function createApiError(status: number, kind?: CloudFailureKind, message?: string): ApiError {
  const resolvedKind = kind ?? (status === 0 ? 'network'
    : status === 401 || status === 403 ? 'auth'
    : status === 408 ? 'timeout' : status === 429 ? 'rate_limited'
    : status >= 500 ? 'server' : status >= 400 ? 'client' : 'unknown')
  return {
    status, kind: resolvedKind,
    retryable: ['network', 'timeout', 'server', 'rate_limited'].includes(resolvedKind),
    message: message ?? getSafeCloudFailureMessage(resolvedKind),
  }
}

export function isApiError(error: unknown): error is ApiError {
  if (typeof error !== 'object' || error === null) return false
  return 'status' in error && typeof error.status === 'number'
    && 'message' in error && typeof error.message === 'string'
    && 'kind' in error && typeof error.kind === 'string'
    && ['network', 'timeout', 'server', 'rate_limited', 'auth', 'client', 'unknown'].includes(error.kind)
    && 'retryable' in error && typeof error.retryable === 'boolean'
}

export const cancelledCloudRequest = (): ApiError => createApiError(0, 'unknown', '请求已取消，请重试')
export const invalidCloudResponse = (): ApiError => createApiError(0, 'unknown', 'Proma Cloud 返回了无效响应，请稍后重试')

export function assertCloudRequestActive(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledCloudRequest()
}

/** 即使底层忽略 abort 也能结束等待；调用者必须在迟到的副作用前检查 signal/账号revision。 */
export async function withCloudDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal | null,
): Promise<T> {
  if (parentSignal?.aborted) throw cancelledCloudRequest()
  const controller = new AbortController()
  let rejectAbort!: (error: ApiError) => void
  let abortError: ApiError | undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const abort = (error: ApiError) => {
    if (abortError) return
    abortError = error
    // 先结算自己的安全错误，避免原生 fetch 的 AbortError 抢先覆盖类别。
    rejectAbort(error)
    controller.abort()
  }
  const onParentAbort = () => abort(cancelledCloudRequest())
  parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => abort(createApiError(0, 'timeout')), Math.max(0, timeoutMs))
  try {
    return await Promise.race([
      Promise.resolve().then(() => { assertCloudRequestActive(controller.signal); return work(controller.signal) }),
      aborted,
    ])
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

export type CloudOperation = 'login' | 'refresh' | 'system_key' | 'catalog' | 'cloud'
interface CloudRequestOptions {
  timeoutMs: number
  operation: CloudOperation
  attempt?: number
  allowNotModified?: boolean
}

const SAFE_CAUSE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])
function safeCauseCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const cause = 'cause' in error ? error.cause : error
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined
  return typeof cause.code === 'string' && SAFE_CAUSE_CODES.has(cause.code) ? cause.code : undefined
}

/** read只负责读取/验证，不能写账号状态或磁盘；这些副作用应在本函数成功返回并校验revision后执行。 */
export async function withCloudRequest<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
  options: CloudRequestOptions,
): Promise<T> {
  const start = Date.now()
  let phase: 'headers' | 'body' = 'headers'
  let status = 0
  try {
    return await withCloudDeadline(async signal => {
      const response = await fetch(url, { ...init, signal })
      assertCloudRequestActive(signal)
      status = response.status
      if (!response.ok && !(options.allowNotModified && status === 304)) {
        void response.body?.cancel().catch(() => {})
        throw createApiError(status)
      }
      phase = 'body'
      const data = await read(response)
      assertCloudRequestActive(signal)
      return data
    }, options.timeoutMs, init.signal)
  } catch (error) {
    const failure = isApiError(error) ? error
      : error instanceof SyntaxError ? invalidCloudResponse()
      : error instanceof Error && error.name === 'AbortError' ? createApiError(0, 'timeout')
      : createApiError(0)
    // 禁止记录URL、响应体、header、token和原始error；cause仅允许固定枚举。
    console.warn('[Cloud Request] 请求失败', {
      operation: options.operation, phase, attempt: options.attempt ?? 0,
      elapsedMs: Date.now() - start, status: failure.status || status,
      kind: failure.kind, causeCode: safeCauseCode(error),
    })
    throw failure
  }
}
