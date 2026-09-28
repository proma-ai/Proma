export const COMPOSER_MIN_EDITOR_HEIGHT = 101
export const COMPOSER_MIN_MESSAGE_HEIGHT = 96
export const COMPOSER_MAX_VIEWPORT_HEIGHT_RATIO = 0.6
const COMPOSER_HEIGHT_STORAGE_PREFIX = 'proma-composer-height:v1'

export interface ComposerLimits {
  maxEditorHeight: number
  maxFrameHeight: number
}

export function getComposerHeightStorageKey(scope: string): string {
  return `${COMPOSER_HEIGHT_STORAGE_PREFIX}:${scope}`
}

export function parseStoredComposerHeight(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const height = Number(value)
  return Number.isFinite(height) && height >= 0 ? Math.round(height) : null
}

export function readStoredComposerHeight(storageKey: string): number | null {
  try {
    return parseStoredComposerHeight(localStorage.getItem(storageKey))
  } catch {
    return null
  }
}

export function writeStoredComposerHeight(storageKey: string, height: number): void {
  try {
    localStorage.setItem(storageKey, String(height))
  } catch {
    // localStorage 不可用时保持当前会话内的拖拽能力。
  }
}

export function getMaximumComposerFrameHeight(
  availableFrameHeight: number,
  viewportHeight: number,
): number {
  return Math.max(0, Math.min(
    availableFrameHeight,
    Math.floor(viewportHeight * COMPOSER_MAX_VIEWPORT_HEIGHT_RATIO),
  ))
}

export function getMaximumComposerEditorHeight(
  maxFrameHeight: number,
  fixedFrameHeight: number,
): number {
  return Math.max(0, maxFrameHeight - Math.max(0, fixedFrameHeight))
}

export function clampComposerEditorHeight(candidateHeight: number, maxEditorHeight: number): number {
  const safeMaximum = Math.max(0, maxEditorHeight)
  const minimum = Math.min(COMPOSER_MIN_EDITOR_HEIGHT, safeMaximum)
  return Math.round(Math.min(safeMaximum, Math.max(minimum, candidateHeight)))
}

export function getDraggedComposerEditorHeight(
  startHeight: number,
  startClientY: number,
  currentClientY: number,
  maxEditorHeight: number,
): number {
  return clampComposerEditorHeight(
    startHeight + startClientY - currentClientY,
    maxEditorHeight,
  )
}

export function measureComposerLimits(frame: HTMLElement): ComposerLimits {
  const viewport = frame.closest<HTMLElement>('[data-composer-viewport]')
  const messageViewport = viewport?.querySelector<HTMLElement>('[data-composer-message-viewport]')
  const chrome = frame.querySelector<HTMLElement>('[data-composer-chrome]')
  const footer = frame.querySelector<HTMLElement>('[data-composer-footer]')
  const frameHeight = frame.getBoundingClientRect().height
  const viewportHeight = viewport?.clientHeight ?? window.innerHeight
  const availableFrameHeight = messageViewport
    ? frameHeight + messageViewport.getBoundingClientRect().height - COMPOSER_MIN_MESSAGE_HEIGHT
    : viewportHeight - COMPOSER_MIN_MESSAGE_HEIGHT
  const maxFrameHeight = getMaximumComposerFrameHeight(availableFrameHeight, viewportHeight)

  const borderHeight = Math.max(0, frame.offsetHeight - frame.clientHeight)
  const fixedFrameHeight = (chrome?.getBoundingClientRect().height ?? 0)
    + (footer?.getBoundingClientRect().height ?? 0)
    + borderHeight

  return {
    maxFrameHeight,
    maxEditorHeight: getMaximumComposerEditorHeight(maxFrameHeight, fixedFrameHeight),
  }
}
