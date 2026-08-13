import type { Rectangle, Display } from 'electron'

export function calculateHoverWindowBounds(
  trayBounds: Rectangle,
  windowSize: { width: number; height: number },
  display: Display,
): Rectangle {
  const { workArea } = display
  const width = windowSize.width
  const clampedHeight = Math.min(windowSize.height, workArea.height)

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2)
  let y = Math.round(trayBounds.y - clampedHeight)

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width))

  if (y < workArea.y) {
    y = trayBounds.y + trayBounds.height
  }

  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - clampedHeight))

  return { x, y, width, height: clampedHeight }
}
