export interface PreviewScrollPosition {
  top: number
  left: number
}

const scrollPositionCache = new Map<string, PreviewScrollPosition>()

function scrollCacheKey(sessionId: string, filePath: string): string {
  return `${sessionId}:${filePath}`
}

export function getPreviewScrollPosition(sessionId: string, filePath: string): PreviewScrollPosition | undefined {
  return scrollPositionCache.get(scrollCacheKey(sessionId, filePath))
}

export function savePreviewScrollPosition(sessionId: string, filePath: string, position: PreviewScrollPosition): void {
  scrollPositionCache.set(scrollCacheKey(sessionId, filePath), position)
}

export function savePreviewScrollFromElement(
  sessionId: string,
  filePath: string,
  element: Pick<HTMLElement, 'scrollTop' | 'scrollLeft'>,
): void {
  savePreviewScrollPosition(sessionId, filePath, {
    top: element.scrollTop,
    left: element.scrollLeft,
  })
}

export function clearPreviewScrollPositionsForSession(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of scrollPositionCache.keys()) {
    if (key.startsWith(prefix)) scrollPositionCache.delete(key)
  }
}
