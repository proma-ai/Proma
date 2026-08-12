/**
 * Lightweight renderer performance diagnostics.
 *
 * Disabled by default. Enable with `?perf=1` or localStorage:
 * `localStorage.setItem('proma-performance-debug', '1')`.
 * When enabled, `window.__promaPerformance.snapshot()` exposes aggregate metrics
 * without leaving a high-frequency trace in normal production sessions.
 */

export interface PerformanceMetric {
  count: number
  totalMs: number
  maxMs: number
  lastMs: number
}

export interface PerformanceSnapshot {
  enabled: boolean
  metrics: Record<string, PerformanceMetric>
  longTasks: number
  lastLongTaskMs: number
}

type PerformanceMetrics = Map<string, PerformanceMetric>

const metrics: PerformanceMetrics = new Map()
let initialized = false
let longTasks = 0
let lastLongTaskMs = 0

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof performance !== 'undefined'
}

export function isPerformanceMonitoringEnabled(): boolean {
  if (!isBrowser()) return false
  return new URLSearchParams(window.location.search).get('perf') === '1'
    || window.localStorage.getItem('proma-performance-debug') === '1'
}

export function recordPerformanceSample(name: string, durationMs: number): void {
  if (!isPerformanceMonitoringEnabled() || !Number.isFinite(durationMs)) return

  const metric = metrics.get(name) ?? { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 }
  metric.count += 1
  metric.totalMs += durationMs
  metric.maxMs = Math.max(metric.maxMs, durationMs)
  metric.lastMs = durationMs
  metrics.set(name, metric)
}

export function measurePerformance<T>(name: string, operation: () => T): T {
  if (!isPerformanceMonitoringEnabled()) return operation()
  const start = performance.now()
  try {
    return operation()
  } finally {
    recordPerformanceSample(name, performance.now() - start)
  }
}

export function getPerformanceSnapshot(): PerformanceSnapshot {
  return {
    enabled: isPerformanceMonitoringEnabled(),
    metrics: Object.fromEntries(metrics.entries()),
    longTasks,
    lastLongTaskMs,
  }
}

export function clearPerformanceMetrics(): void {
  metrics.clear()
  longTasks = 0
  lastLongTaskMs = 0
}

export function initializePerformanceMonitor(): void {
  if (!isBrowser() || initialized || !isPerformanceMonitoringEnabled()) return
  initialized = true

  window.__promaPerformance = {
    snapshot: getPerformanceSnapshot,
    clear: clearPerformanceMetrics,
  }

  // Chromium/Electron supports Long Task entries. Keep the observer optional so
  // diagnostics never affect startup on runtimes that omit this entry type.
  try {
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        longTasks += 1
        lastLongTaskMs = entry.duration
        recordPerformanceSample('renderer.long-task', entry.duration)
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    // Unsupported browsers simply expose the synchronous metrics above.
  }
}
