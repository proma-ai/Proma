import * as React from 'react'
import {
  COMPOSER_MIN_EDITOR_HEIGHT,
  clampComposerEditorHeight,
  getComposerHeightStorageKey,
  getDraggedComposerEditorHeight,
  measureComposerLimits,
  readStoredComposerHeight,
  type ComposerLimits,
  writeStoredComposerHeight,
} from './composer-resize'

type DragCleanup = (commit: boolean) => void

interface DragSession {
  updateLimits: (limits: ComposerLimits) => void
}

export function useComposerResize(storageScope: string) {
  const frameNodeRef = React.useRef<HTMLDivElement | null>(null)
  const editorNodeRef = React.useRef<HTMLDivElement | null>(null)
  const [mountedNodesVersion, bumpMountedNodesVersion] = React.useReducer((version: number) => version + 1, 0)
  const storageKey = getComposerHeightStorageKey(storageScope)
  const [editorHeight, setEditorHeight] = React.useState<number | null>(() => readStoredComposerHeight(storageKey))
  const editorHeightRef = React.useRef(editorHeight)
  const limitsRef = React.useRef<ComposerLimits | null>(null)
  const dragCleanupRef = React.useRef<DragCleanup | null>(null)
  const dragSessionRef = React.useRef<DragSession | null>(null)
  const focusFrameRef = React.useRef(0)

  const frameRef = React.useCallback((node: HTMLDivElement | null): void => {
    if (frameNodeRef.current === node) return
    frameNodeRef.current = node
    bumpMountedNodesVersion()
  }, [])

  const editorRef = React.useCallback((node: HTMLDivElement | null): void => {
    if (editorNodeRef.current === node) return
    editorNodeRef.current = node
    bumpMountedNodesVersion()
  }, [])

  const commitHeight = React.useCallback((height: number): void => {
    editorHeightRef.current = height
    setEditorHeight(height)
    writeStoredComposerHeight(storageKey, height)
  }, [storageKey])

  React.useLayoutEffect(() => {
    const frame = frameNodeRef.current
    const editor = editorNodeRef.current
    if (!frame || !editor) return

    const restoredHeight = readStoredComposerHeight(storageKey)
    editorHeightRef.current = restoredHeight
    setEditorHeight(restoredHeight)
    editor.style.height = restoredHeight === null ? '' : `${restoredHeight}px`
    const viewport = frame.closest<HTMLElement>('[data-composer-viewport]')
    const messageViewport = viewport?.querySelector<HTMLElement>('[data-composer-message-viewport]')
    const footer = frame.querySelector<HTMLElement>('[data-composer-footer]')
    let animationFrame = 0

    const applyLimits = (limits: ComposerLimits): void => {
      limitsRef.current = limits
      frame.style.maxHeight = `${limits.maxFrameHeight}px`
      editor.style.minHeight = `${Math.min(COMPOSER_MIN_EDITOR_HEIGHT, limits.maxEditorHeight)}px`
    }

    const updateLayout = (): void => {
      animationFrame = 0
      const limits = measureComposerLimits(frame)
      applyLimits(limits)

      if (dragSessionRef.current) {
        dragSessionRef.current.updateLimits(limits)
        return
      }

      const currentHeight = editorHeightRef.current
      if (currentHeight === null) return
      const nextHeight = clampComposerEditorHeight(currentHeight, limits.maxEditorHeight)
      editor.style.height = `${nextHeight}px`
      if (nextHeight !== currentHeight) commitHeight(nextHeight)
    }

    const scheduleUpdate = (): void => {
      if (animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(updateLayout)
      }
    }

    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(frame)
    observer.observe(editor)
    if (viewport) observer.observe(viewport)
    if (messageViewport) observer.observe(messageViewport)
    if (footer) observer.observe(footer)
    window.addEventListener('resize', scheduleUpdate)
    updateLayout()

    return () => {
      dragCleanupRef.current?.(false)
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame)
      if (focusFrameRef.current !== 0) window.cancelAnimationFrame(focusFrameRef.current)
      observer.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [commitHeight, mountedNodesVersion, storageKey])

  const onResizePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const frame = frameNodeRef.current
    const editor = editorNodeRef.current
    if (!frame || !editor) return

    event.preventDefault()
    event.stopPropagation()
    dragCleanupRef.current?.(true)

    const handle = event.currentTarget
    const pointerId = event.pointerId
    const startClientY = event.clientY
    const initialLimits = measureComposerLimits(frame)
    limitsRef.current = initialLimits
    frame.style.maxHeight = `${initialLimits.maxFrameHeight}px`
    editor.style.minHeight = `${Math.min(COMPOSER_MIN_EDITOR_HEIGHT, initialLimits.maxEditorHeight)}px`
    const startHeight = clampComposerEditorHeight(
      editor.getBoundingClientRect().height,
      initialLimits.maxEditorHeight,
    )
    const controller = new AbortController()
    let currentClientY = startClientY
    let latestHeight = startHeight
    let cleaned = false
    const previous = {
      bodyCursor: document.body.style.cursor,
      bodyUserSelect: document.body.style.userSelect,
      editorTransition: editor.style.transition,
      frameTransition: frame.style.transition,
      backdropFilter: frame.style.backdropFilter,
    }

    const applyDraggedHeight = (limits: ComposerLimits): void => {
      latestHeight = getDraggedComposerEditorHeight(
        startHeight,
        startClientY,
        currentClientY,
        limits.maxEditorHeight,
      )
      editor.style.height = `${latestHeight}px`
    }

    const cleanup: DragCleanup = (commit) => {
      if (cleaned) return
      cleaned = true
      controller.abort()
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      document.body.style.cursor = previous.bodyCursor
      document.body.style.userSelect = previous.bodyUserSelect
      editor.style.transition = previous.editorTransition
      frame.style.transition = previous.frameTransition
      frame.style.backdropFilter = previous.backdropFilter
      dragCleanupRef.current = null
      dragSessionRef.current = null

      if (!commit) {
        editor.style.height = editorHeightRef.current === null ? '' : `${editorHeightRef.current}px`
        return
      }

      const finalLimits = measureComposerLimits(frame)
      limitsRef.current = finalLimits
      frame.style.maxHeight = `${finalLimits.maxFrameHeight}px`
      editor.style.minHeight = `${Math.min(COMPOSER_MIN_EDITOR_HEIGHT, finalLimits.maxEditorHeight)}px`
      const committedHeight = clampComposerEditorHeight(latestHeight, finalLimits.maxEditorHeight)
      editor.style.height = `${committedHeight}px`
      commitHeight(committedHeight)
      focusFrameRef.current = window.requestAnimationFrame(() => {
        editor.querySelector<HTMLElement>('.ProseMirror')?.focus()
      })
    }

    const finishPointer = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId === pointerId) cleanup(true)
    }

    const movePointer = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return
      pointerEvent.preventDefault()
      currentClientY = pointerEvent.clientY
      applyDraggedHeight(limitsRef.current ?? measureComposerLimits(frame))
    }

    editorHeightRef.current = startHeight
    setEditorHeight(startHeight)
    editor.style.height = `${startHeight}px`
    editor.style.transition = 'none'
    frame.style.transition = 'none'
    frame.style.backdropFilter = 'none'
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    dragCleanupRef.current = cleanup
    dragSessionRef.current = { updateLimits: applyDraggedHeight }

    const listenerOptions = { signal: controller.signal }
    handle.addEventListener('pointermove', movePointer, listenerOptions)
    handle.addEventListener('pointerup', finishPointer, listenerOptions)
    handle.addEventListener('pointercancel', finishPointer, listenerOptions)
    handle.addEventListener('lostpointercapture', finishPointer, listenerOptions)
    window.addEventListener('blur', () => cleanup(true), listenerOptions)
    handle.setPointerCapture(pointerId)
  }, [commitHeight])

  return { editorHeight, editorRef, frameRef, onResizePointerDown }
}
