/** 低额度充值提醒的阈值与跨阈值判定。 */
export const LOW_CREDIT_THRESHOLDS = [20, 10, 5, 2] as const

/**
 * 返回本次余额变化需要提示的最低阈值。
 * 首次取得低额度快照时也会提示一次；一次扣费跨越多个阈值时，只提示最紧急的一个。
 */
export function getCrossedLowCreditThreshold(
  previousTotal: number | null,
  currentTotal: number,
): number | null {
  if (!Number.isFinite(currentTotal) || currentTotal > LOW_CREDIT_THRESHOLDS[0]) return null

  if (previousTotal === null) {
    return LOW_CREDIT_THRESHOLDS.filter((threshold) => currentTotal <= threshold).at(-1) ?? null
  }

  const crossed = LOW_CREDIT_THRESHOLDS.filter((threshold) => (
    previousTotal > threshold && currentTotal <= threshold
  ))

  return crossed.at(-1) ?? null
}
