/**
 * 选择 headless Agent 运行应接收事件的 renderer。
 *
 * 委派子会话优先复用父会话所在窗口；没有可用父窗口时才回退通用主窗口。
 */
export interface HeadlessAgentRunTarget {
  isDestroyed(): boolean
}

export function getHeadlessAgentRunTarget<T extends HeadlessAgentRunTarget>(
  sessionTargets: ReadonlyMap<string, T>,
  originSessionId: string | undefined,
  getFallbackTarget: () => T | null,
): T | null {
  const originTarget = originSessionId ? sessionTargets.get(originSessionId) : undefined
  if (originTarget && !originTarget.isDestroyed()) {
    return originTarget
  }

  return getFallbackTarget()
}
