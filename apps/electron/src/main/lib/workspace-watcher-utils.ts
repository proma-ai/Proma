// 高频变动目录：跳过其中的变更事件，防止 node_modules / .next 等产生 IPC 事件风暴。
const HIGH_NOISE_SEGMENTS = new Set([
  'node_modules', '.next', '.nuxt', '.git', 'dist', 'build',
  '.cache', '__pycache__', '.turbo', '.parcel-cache', '.svelte-kit',
])

export function isHighNoisePath(normalizedPath: string): boolean {
  return normalizedPath.split('/').some((seg) => HIGH_NOISE_SEGMENTS.has(seg))
}

/** fs.watch 在部分平台/事件上可能返回 Buffer 或 null。未知路径不触发刷新，避免绕过噪声过滤。 */
export function normalizeWatchFilename(filename: string | Buffer | null): string | null {
  if (typeof filename === 'string') return filename.replace(/\\/g, '/')
  if (Buffer.isBuffer(filename)) return filename.toString('utf8').replace(/\\/g, '/')
  return null
}

export function shouldNotifyForWatchFilename(filename: string | Buffer | null): boolean {
  const normalizedFilename = normalizeWatchFilename(filename)
  return normalizedFilename !== null && !isHighNoisePath(normalizedFilename)
}
