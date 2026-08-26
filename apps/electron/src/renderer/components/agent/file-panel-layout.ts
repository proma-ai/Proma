export const WIDE_FILE_PANEL_MIN_WIDTH = 760

export function shouldShowBothFileSources(width: number): boolean {
  return width >= WIDE_FILE_PANEL_MIN_WIDTH
}
