/**
 * Tracks local controlled-input updates until their React props echo back.
 * A delayed older echo must not be treated as a genuine external replacement.
 */
export function recordLocalDraftEcho(pending: readonly string[], value: string): string[] {
  // 不能截断：一旦丢掉仍在路上的旧 echo，它到达时又会被误判成外部内容，
  // 重新触发整篇 setContent。受控状态确认最新值后调用方会立即清空此队列。
  return [...pending, value]
}

/**
 * Returns the remaining pending echoes when `value` is local; otherwise null.
 * Consuming through the matching entry also discards older echoes that have
 * already reached the controlled component.
 */
export function consumeLocalDraftEcho(pending: readonly string[], value: string): string[] | null {
  const echoIndex = pending.indexOf(value)
  return echoIndex === -1 ? null : pending.slice(echoIndex + 1)
}
