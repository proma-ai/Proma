export const RENDERER_RECOVERY_WINDOW_MS = 30_000
export const MAX_RENDERER_RECOVERY_ATTEMPTS = 2

export function canRecoverRenderer(attempts: number[], now: number): boolean {
  const recentAttempts = attempts.filter((attemptAt) => now - attemptAt < RENDERER_RECOVERY_WINDOW_MS)
  return recentAttempts.length < MAX_RENDERER_RECOVERY_ATTEMPTS
}
