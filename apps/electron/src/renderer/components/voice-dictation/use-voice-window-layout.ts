/**
 * 语音输入浮窗布局测量
 */

import * as React from 'react'

const WINDOW_HEIGHT_BUFFER = 16
const LINE_HEIGHT = 28
const MIN_TRANSCRIPT_HEIGHT = 34
const MAX_TRANSCRIPT_HEIGHT = 260
const MAX_WINDOW_HEIGHT = 540

interface VoiceWindowLayoutInput {
  commitResultMessage: string | null
  message: string
  status: string
  transcript: string
}

export interface VoiceWindowLayoutRefs {
  rootRef: React.RefObject<HTMLDivElement>
  panelRef: React.RefObject<HTMLDivElement>
  headerRef: React.RefObject<HTMLDivElement>
  hintBarRef: React.RefObject<HTMLDivElement>
  transcriptBoxRef: React.RefObject<HTMLDivElement>
}

export interface VoiceWindowLayoutResult extends VoiceWindowLayoutRefs {
  transcriptMaxHeight: number | null
}

export function useVoiceWindowLayout(input: VoiceWindowLayoutInput): VoiceWindowLayoutResult {
  const { commitResultMessage, message, status, transcript } = input
  const [transcriptMaxHeight, setTranscriptMaxHeight] = React.useState<number | null>(null)

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const headerRef = React.useRef<HTMLDivElement | null>(null)
  const hintBarRef = React.useRef<HTMLDivElement | null>(null)
  const transcriptBoxRef = React.useRef<HTMLDivElement | null>(null)
  const lastWindowHeightRef = React.useRef(0)

  const scrollTranscriptToBottom = React.useCallback(() => {
    const transcriptBox = transcriptBoxRef.current
    if (!transcriptBox) return
    const maxScrollTop = Math.max(0, transcriptBox.scrollHeight - transcriptBox.clientHeight)
    transcriptBox.scrollTop = maxScrollTop
  }, [])

  const requestTranscriptBottomScroll = React.useCallback(() => {
    requestAnimationFrame(() => {
      scrollTranscriptToBottom()
      requestAnimationFrame(scrollTranscriptToBottom)
    })
  }, [scrollTranscriptToBottom])

  const resizeVoiceWindow = React.useCallback(() => {
    const root = rootRef.current
    const header = headerRef.current
    const hintBar = hintBarRef.current
    const transcriptBox = transcriptBoxRef.current
    if (!root || !header || !hintBar || !transcriptBox) return

    const rootStyle = window.getComputedStyle(root)
    const rootVerticalPadding =
      Number.parseFloat(rootStyle.paddingTop) +
      Number.parseFloat(rootStyle.paddingBottom)
    const transcriptNaturalHeight = Math.ceil(Math.max(MIN_TRANSCRIPT_HEIGHT, transcriptBox.scrollHeight))
    const fixedHeight = Math.ceil(
      rootVerticalPadding +
      header.getBoundingClientRect().height +
      hintBar.getBoundingClientRect().height +
      1,
    )
    const maxWindowHeight = Math.max(
      220,
      Math.min(MAX_WINDOW_HEIGHT, window.screen.availHeight - 24),
    )
    const availableTranscriptHeight = Math.max(
      MIN_TRANSCRIPT_HEIGHT,
      maxWindowHeight - fixedHeight - WINDOW_HEIGHT_BUFFER,
    )
    const viewportMaxTranscriptHeight = Math.min(MAX_TRANSCRIPT_HEIGHT, availableTranscriptHeight)
    const nextTranscriptMaxHeight =
      transcriptNaturalHeight > viewportMaxTranscriptHeight
        ? viewportMaxTranscriptHeight
        : null
    const nextTranscriptHeight = nextTranscriptMaxHeight ?? transcriptNaturalHeight
    const extraBuffer = nextTranscriptMaxHeight === null ? LINE_HEIGHT : 0
    const nextHeight = Math.ceil(fixedHeight + nextTranscriptHeight + WINDOW_HEIGHT_BUFFER + extraBuffer)

    setTranscriptMaxHeight((current) => {
      if (current === null && nextTranscriptMaxHeight === null) return current
      if (current !== null && nextTranscriptMaxHeight !== null && Math.abs(current - nextTranscriptMaxHeight) < 2) {
        return current
      }
      return nextTranscriptMaxHeight
    })

    if (Math.abs(nextHeight - lastWindowHeightRef.current) < 1) return
    lastWindowHeightRef.current = nextHeight
    window.electronAPI.resizeVoiceDictation({ height: nextHeight }).catch(console.error)
  }, [])

  React.useLayoutEffect(() => {
    resizeVoiceWindow()
    const observer = new ResizeObserver(() => {
      resizeVoiceWindow()
      requestTranscriptBottomScroll()
    })
    if (rootRef.current) observer.observe(rootRef.current)
    if (panelRef.current) observer.observe(panelRef.current)
    if (headerRef.current) observer.observe(headerRef.current)
    if (hintBarRef.current) observer.observe(hintBarRef.current)
    if (transcriptBoxRef.current) observer.observe(transcriptBoxRef.current)
    return () => observer.disconnect()
  }, [requestTranscriptBottomScroll, resizeVoiceWindow])

  React.useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      resizeVoiceWindow()
      scrollTranscriptToBottom()
      requestAnimationFrame(scrollTranscriptToBottom)
    })
    return () => cancelAnimationFrame(frame)
  }, [commitResultMessage, message, resizeVoiceWindow, scrollTranscriptToBottom, status, transcript])

  React.useLayoutEffect(() => {
    requestTranscriptBottomScroll()
  }, [requestTranscriptBottomScroll, transcript, transcriptMaxHeight])

  React.useEffect(() => {
    const handleWindowResize = (): void => {
      lastWindowHeightRef.current = 0
      resizeVoiceWindow()
      requestTranscriptBottomScroll()
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [requestTranscriptBottomScroll, resizeVoiceWindow])

  return {
    rootRef,
    panelRef,
    headerRef,
    hintBarRef,
    transcriptBoxRef,
    transcriptMaxHeight,
  }
}
