import type { MarkdownScrollPosition } from '@/lib/markdown-editor-state'

export interface MarkdownScrollRestoreMaskOptions {
  isMarkdown: boolean
  loading: boolean
  cachedScrollPosition: MarkdownScrollPosition | undefined
  restoredScrollKey: string | null
  scrollKey: string
  /** ink-mde 已挂载时，后续任意 React 重渲染都不应重新遮罩正文。 */
  editorReady: boolean
}

/** 异步恢复仍属于当前导航时才允许它回写滚动位置。 */
export function isCurrentMarkdownScrollRestore(restoreEpoch: number, currentEpoch: number): boolean {
  return restoreEpoch === currentEpoch
}

/**
 * 正文只在仍有待完成的非零滚动恢复时隐藏，避免先显示文档顶部再跳回阅读位置。
 * 用户主动目录跳转会把当前 key 标记为已完成，从而立即解除遮罩。
 */
export function shouldMaskMarkdownForScrollRestore({
  isMarkdown,
  loading,
  cachedScrollPosition,
  restoredScrollKey,
  scrollKey,
  editorReady,
}: MarkdownScrollRestoreMaskOptions): boolean {
  return Boolean(
    isMarkdown
      && !loading
      && !editorReady
      && cachedScrollPosition
      && (cachedScrollPosition.top > 0 || cachedScrollPosition.left > 0)
      && restoredScrollKey !== scrollKey,
  )
}
