export type ResolveLiveMarkdownMediaCandidate = (candidate: string) => Promise<string | null>

function stripQueryAndHash(value: string): string {
  return value.replace(/[?#].*$/, '')
}

function isSafeRelativeMediaSource(src: string): boolean {
  const raw = stripQueryAndHash(src.trim())
  if (!raw || raw.includes('\0')) return false
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return false
  }
  if (!decoded || decoded.includes('\0') || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) return false
  if (decoded.startsWith('/') || decoded.startsWith('\\')) return false
  return decoded.split(/[\\/]+/).every((segment) => segment !== '..')
}

/**
 * 返回交给主进程的原始相对 source。安全校验只能以主进程的 realpath 结果为准，
 * 因此 renderer 不拼接绝对路径或预览根作为回退候选。
 */
export function getLiveMarkdownMediaCandidates(_markdownFilePath: string, src: string): string[] {
  const source = src.trim()
  return isSafeRelativeMediaSource(source) ? [source] : []
}

export function createLiveMarkdownImageResolver(
  markdownFilePath: string,
  resolveCandidate: ResolveLiveMarkdownMediaCandidate,
): ResolveLiveMarkdownMediaCandidate {
  const cache = new Map<string, Promise<string | null>>()
  return (src) => {
    const existing = cache.get(src)
    if (existing) return existing
    const pending = resolveLiveMarkdownImageSrc(markdownFilePath, src, resolveCandidate)
    cache.set(src, pending)
    return pending
  }
}

/** 只接受主进程按当前 Markdown 所在目录授权并换成 token-gated URL 的本地图片结果。 */
export async function resolveLiveMarkdownImageSrc(
  markdownFilePath: string,
  src: string,
  resolveCandidate: ResolveLiveMarkdownMediaCandidate,
): Promise<string | null> {
  if (/^(?:https?:|data:|blob:|proma-file:)/i.test(src)) return src
  for (const candidate of getLiveMarkdownMediaCandidates(markdownFilePath, src)) {
    const resolved = await resolveCandidate(candidate)
    if (resolved) return resolved
  }
  return null
}
