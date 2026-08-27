export const RIGHT_PANEL_MAX_VIEWPORT_RATIO = 3 / 5
export const MIN_MAIN_AREA_WIDTH = 320

export function getRightPanelMaxWidth(
  viewportWidth: number,
  leftSidebarOccupiedWidth: number,
  allowFullAvailableWidth = false,
): number {
  const availableWidth = viewportWidth - leftSidebarOccupiedWidth - MIN_MAIN_AREA_WIDTH
  return Math.max(
    0,
    allowFullAvailableWidth
      ? availableWidth
      : Math.min(
        Math.floor(viewportWidth * RIGHT_PANEL_MAX_VIEWPORT_RATIO),
        availableWidth,
      ),
  )
}

export function clampRightPanelWidth(
  width: number,
  viewportWidth: number,
  minimumWidth: number,
  leftSidebarOccupiedWidth: number,
  allowFullAvailableWidth = false,
): number {
  const maximumWidth = getRightPanelMaxWidth(
    viewportWidth,
    leftSidebarOccupiedWidth,
    allowFullAvailableWidth,
  )
  const effectiveMinimumWidth = Math.min(minimumWidth, maximumWidth)
  return Math.max(effectiveMinimumWidth, Math.min(maximumWidth, width))
}
