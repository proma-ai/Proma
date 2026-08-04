export interface VoiceDictationPreviewRange {
  sessionId: string
  from: number
  to: number
  text: string
}

/**
 * Static ProseMirror positions become unsafe after the document is edited.
 * Only remove a voice preview when the original text is still at its range.
 */
export function isVoiceDictationPreviewRangeCurrent(
  preview: VoiceDictationPreviewRange,
  readText: (from: number, to: number) => string,
): boolean {
  return readText(preview.from, preview.to) === preview.text
}
