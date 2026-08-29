/**
 * Tables stay rendered for a passive selection (including the initial cursor),
 * but switch to Markdown source after the user explicitly clicks the preview.
 */
export function shouldRenderLiveMarkdownBlockPreview(
  kind: 'table' | 'other',
  hasActiveSelectionInBlock: boolean,
  isExplicitlyEditingTable = false,
): boolean {
  return kind === 'table' ? !isExplicitlyEditingTable : !hasActiveSelectionInBlock
}
