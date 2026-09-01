import * as React from 'react'
import { EditorView } from '@codemirror/view'
import {
  VaultScrollSession,
  isVaultScrollTakeoverKey,
  readVaultScrollAnchor,
  writeVaultScrollAnchor,
  type VaultScrollAnchor,
} from './vault-scroll-memory'

/** Reads the document anchor that is currently at the top of the viewport. */
export function readVaultScrollAnchorFromView(view: EditorView): VaultScrollAnchor | null {
  const scroller = view.scrollDOM
  const rect = scroller.getBoundingClientRect()
  if (rect.height === 0) return null
  if (scroller.scrollTop <= 0) return { pos: 0, lineOffset: 0 }

  const pos = view.posAtCoords({ x: rect.left + 4, y: rect.top + 1 }, false)
  if (pos == null) return null
  const line = view.lineBlockAt(pos)
  const coords = view.coordsAtPos(line.from)
  const lineOffset = coords ? Math.max(0, Math.round(rect.top - coords.top)) : 0
  return { pos: line.from, lineOffset }
}

interface UseVaultScrollMemoryOptions {
  /** Returns the live CodeMirror view; null until the editor has mounted. */
  getView: () => EditorView | null
  storageKey: string
}

export interface VaultScrollMemoryView {
  readonly scrollDOM: HTMLElement
  readonly state: EditorView['state']
  dispatch: EditorView['dispatch']
}

export interface VaultScrollMemoryRuntime {
  now: () => number
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void
  readAnchorFromView: (view: VaultScrollMemoryView) => VaultScrollAnchor | null
}

const RESTORE_CHECK_INTERVAL_MS = 100

const browserRuntime: VaultScrollMemoryRuntime = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (handle) => clearTimeout(handle),
  readAnchorFromView: (view) => readVaultScrollAnchorFromView(view as EditorView),
}

/**
 * Wires one live EditorView to scroll memory. Kept outside React so tests can
 * exercise the actual event/timer/dispatch contract without pretending a
 * headless DOM has CodeMirror layout measurements.
 */
export function attachVaultScrollMemory(
  view: VaultScrollMemoryView,
  storageKey: string,
  runtime: VaultScrollMemoryRuntime = browserRuntime,
  onTakeOverReady?: (takeOver: () => void) => void,
): () => void {
  let disposed = false
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let restoreCheckTimer: ReturnType<typeof setTimeout> | null = null
  let restoreFrame = 0
  let offsetFrame = 0
  const scroller = view.scrollDOM
  const session = new VaultScrollSession(readVaultScrollAnchor(storageKey), runtime.now())

  const stopRestoreController = (): void => {
    if (restoreCheckTimer !== null) {
      runtime.clearTimer(restoreCheckTimer)
      restoreCheckTimer = null
    }
    if (restoreFrame) {
      runtime.cancelFrame(restoreFrame)
      restoreFrame = 0
    }
    if (offsetFrame) {
      runtime.cancelFrame(offsetFrame)
      offsetFrame = 0
    }
  }

  const persistNow = (): void => {
    persistTimer = null
    if (disposed || !session.canRemember(runtime.now())) return
    const anchor = runtime.readAnchorFromView(view)
    if (!anchor) return
    writeVaultScrollAnchor(storageKey, session.remember(anchor))
  }

  const handleScroll = (): void => {
    if (persistTimer !== null) return
    persistTimer = runtime.setTimer(persistNow, 150)
  }

  const handleUserIntent = (): void => {
    session.takeOver()
    stopRestoreController()
  }

  const handleKeydown = (event: Event): void => {
    if (event instanceof KeyboardEvent && isVaultScrollTakeoverKey(event.key)) handleUserIntent()
  }

  onTakeOverReady?.(handleUserIntent)

  const scheduleRestoreCheck = (delay = RESTORE_CHECK_INTERVAL_MS): void => {
    const now = runtime.now()
    if (disposed || !session.isRestoreSettling(now)) return
    const remaining = session.restoreTimeRemaining(now)
    if (remaining <= 0) return
    restoreCheckTimer = runtime.setTimer(() => {
      restoreCheckTimer = null
      verifyRestore()
    }, Math.min(delay, remaining))
  }

  const applyRestore = (anchor: VaultScrollAnchor): void => {
    if (disposed || !session.isRestoreSettling(runtime.now())) return
    view.dispatch({
      effects: EditorView.scrollIntoView(
        Math.min(anchor.pos, view.state.doc.length),
        { y: 'start', yMargin: 0 },
      ),
    })

    if (anchor.lineOffset > 0) {
      offsetFrame = runtime.requestFrame(() => {
        offsetFrame = 0
        if (disposed || !session.isRestoreSettling(runtime.now())) return
        scroller.scrollTop += anchor.lineOffset
        scheduleRestoreCheck()
      })
    } else {
      scheduleRestoreCheck()
    }
  }

  const verifyRestore = (): void => {
    if (disposed || !session.isRestoreSettling(runtime.now())) return
    const correction = session.verifyRestore(runtime.readAnchorFromView(view), runtime.now())
    if (correction) applyRestore(correction)
    else scheduleRestoreCheck()
  }

  const applyInitialRestore = (): void => {
    restoreFrame = 0
    if (disposed) return
    const anchor = session.beginRestore(runtime.now())
    if (anchor) applyRestore(anchor)
  }

  scroller.addEventListener('scroll', handleScroll, { passive: true })
  scroller.addEventListener('wheel', handleUserIntent, { passive: true })
  scroller.addEventListener('pointerdown', handleUserIntent, { passive: true })
  scroller.addEventListener('keydown', handleKeydown)
  restoreFrame = runtime.requestFrame(applyInitialRestore)

  return () => {
    if (disposed) return
    disposed = true
    scroller.removeEventListener('scroll', handleScroll)
    scroller.removeEventListener('wheel', handleUserIntent)
    scroller.removeEventListener('pointerdown', handleUserIntent)
    scroller.removeEventListener('keydown', handleKeydown)
    stopRestoreController()
    if (persistTimer !== null) runtime.clearTimer(persistTimer)

    // Persist the latest reader position before a tab switch destroys the view.
    const live = session.canRemember(runtime.now()) ? runtime.readAnchorFromView(view) : null
    const anchor = live ?? session.anchorForTeardown()
    if (anchor) writeVaultScrollAnchor(storageKey, anchor)
  }
}

/**
 * Restores after ink-mde reports that its CodeMirror view is ready. Waiting for
 * onReady avoids racing its promise and avoids polling/duplicate attachment.
 */
export function useVaultScrollMemory({ getView, storageKey }: UseVaultScrollMemoryOptions): {
  onEditorReady: () => void
  takeOver: () => void
} {
  const [readyToken, setReadyToken] = React.useState(0)
  const takeOverRef = React.useRef<() => void>(() => undefined)

  React.useEffect(() => {
    takeOverRef.current = () => undefined
    if (readyToken === 0) return
    const view = getView()
    if (!view) return
    const detach = attachVaultScrollMemory(view, storageKey, browserRuntime, (takeOver) => {
      takeOverRef.current = takeOver
    })
    return () => {
      detach()
      takeOverRef.current = () => undefined
    }
  }, [getView, storageKey, readyToken])

  return {
    onEditorReady: React.useCallback(() => {
      setReadyToken((token) => token + 1)
    }, []),
    takeOver: React.useCallback(() => {
      takeOverRef.current()
    }, []),
  }
}
