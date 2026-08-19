// 高频变动目录：跳过依赖、缓存和构建中间物，防止产生 IPC 事件风暴。
const HIGH_NOISE_SEGMENTS = new Set([
  'node_modules', '.next', '.nuxt', '.git', 'dist', 'build',
  '.cache', '__pycache__', '.turbo', '.parcel-cache', '.svelte-kit',
  '.venv', 'venv', '.tox', '.nox', '__pypackages__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.hypothesis',
  '.gradle',
])

const GIT_DIFF_STATE_FILES = new Set([
  'HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'index',
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

/**
 * 只有直接影响 `git diff HEAD` 结果的 Git 元数据才触发刷新。
 * 远端 fetch 产生的 FETCH_HEAD、refs/remotes 与 objects 均不在范围内，避免重现刷新循环。
 */
export function isGitDiffStatePath(normalizedPath: string): boolean {
  const segments = normalizedPath.split('/').filter(Boolean)
  const gitIndex = segments.lastIndexOf('.git')
  if (gitIndex < 0) return false
  const gitRelativePath = segments.slice(gitIndex + 1)
  return gitRelativePath.length === 1 && GIT_DIFF_STATE_FILES.has(gitRelativePath[0]!)
}

export function shouldNotifyForWatchFilename(filename: string | Buffer | null): boolean {
  const normalizedFilename = normalizeWatchFilename(filename)
  return normalizedFilename !== null && (!isHighNoisePath(normalizedFilename) || isGitDiffStatePath(normalizedFilename))
}
