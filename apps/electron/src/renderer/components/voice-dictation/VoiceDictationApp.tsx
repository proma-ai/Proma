/**
 * VoiceDictationApp — 系统级语音输入浮窗
 */

import * as React from 'react'
import { Check, Clipboard, Loader2, Mic, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VoiceDictationCommitResult, VoiceDictationSettings, VoiceDictationStateEvent, VoiceDictationTranscriptEvent } from '../../../types'
import { CHUNK_BYTES, concatAudioBuffers, floatTo16BitPcm, splitChunk } from './voice-audio-utils'
import { mergeVoiceDictationTranscript } from './voice-transcript-merge'
import type { VoiceDictationTranscriptMergeState } from './voice-transcript-merge'
import { useVoiceWindowLayout } from './use-voice-window-layout'

const MAX_QUEUED_CHUNKS = 60
const STOP_COMMIT_TIMEOUT_MS = 1400
const FINAL_COMMIT_DELAY_MS = 180

export function VoiceDictationApp(): React.ReactElement {
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<VoiceDictationStateEvent['status']>('idle')
  const [message, setMessage] = React.useState('按快捷键开始语音输入')
  const [transcript, setTranscript] = React.useState('')
  const [commitResult, setCommitResult] = React.useState<VoiceDictationCommitResult | null>(null)
  const [volume, setVolume] = React.useState(0)

  const sessionIdRef = React.useRef<string | null>(null)
  const transcriptRef = React.useRef('')
  const transcriptMergeStateRef = React.useRef<VoiceDictationTranscriptMergeState>({
    committedText: '',
    currentSessionText: '',
    currentSessionId: '',
  })
  const streamRef = React.useRef<MediaStream | null>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const processorRef = React.useRef<ScriptProcessorNode | null>(null)
  const pendingAudioRef = React.useRef<ArrayBuffer[]>([])
  const queuedAudioRef = React.useRef<ArrayBuffer[]>([])
  const asrReadyRef = React.useRef(false)
  const stoppingRef = React.useRef(false)
  const settingsRef = React.useRef<VoiceDictationSettings | null>(null)
  const commitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitInFlightRef = React.useRef(false)

  const {
    rootRef,
    panelRef,
    headerRef,
    hintBarRef,
    transcriptBoxRef,
    transcriptMaxHeight,
  } = useVoiceWindowLayout({
    commitResultMessage: commitResult?.message ?? null,
    message,
    status,
    transcript,
  })

  React.useEffect(() => {
    document.body.style.background = 'hsl(var(--background))'
    document.documentElement.style.background = 'hsl(var(--background))'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.padding = '0'
  }, [])

  React.useEffect(() => {
    window.electronAPI.getVoiceDictationSettings()
      .then((settings) => {
        settingsRef.current = settings
      })
      .catch(console.error)
  }, [])

  const cleanupAudio = React.useCallback((clearBufferedAudio = true) => {
    processorRef.current?.disconnect()
    processorRef.current = null
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (clearBufferedAudio) {
      pendingAudioRef.current = []
      queuedAudioRef.current = []
      asrReadyRef.current = false
    }
    setVolume(0)
  }, [])

  const sendAudioChunk = React.useCallback((sessionId: string, chunk: ArrayBuffer) => {
    if (!asrReadyRef.current) {
      queuedAudioRef.current.push(chunk)
      if (queuedAudioRef.current.length > MAX_QUEUED_CHUNKS) {
        queuedAudioRef.current.shift()
      }
      return
    }

    window.electronAPI.sendVoiceDictationAudio({
      sessionId,
      data: chunk,
    }).catch(console.error)
  }, [])

  const flushQueuedAudio = React.useCallback(() => {
    const currentSessionId = sessionIdRef.current
    if (!currentSessionId) return
    const chunks = queuedAudioRef.current
    queuedAudioRef.current = []
    for (const chunk of chunks) {
      sendAudioChunk(currentSessionId, chunk)
    }
  }, [sendAudioChunk])

  const flushPendingAudio = React.useCallback(() => {
    const currentSessionId = sessionIdRef.current
    if (!currentSessionId || pendingAudioRef.current.length === 0) return
    const audio = concatAudioBuffers(pendingAudioRef.current)
    pendingAudioRef.current = []
    if (audio.byteLength > 0) {
      sendAudioChunk(currentSessionId, audio)
    }
  }, [sendAudioChunk])

  const commitAndHide = React.useCallback(async () => {
    if (commitInFlightRef.current) return
    commitInFlightRef.current = true
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    const text = transcriptRef.current.trim()
    if (!text) {
      setStatus('idle')
      setMessage('没有识别到语音内容')
      cleanupAudio()
      setTimeout(() => window.electronAPI.hideVoiceDictation().catch(console.error), 180)
      return
    }

    setStatus('stopping')
    setMessage('正在输出文本...')
    try {
      const result = await window.electronAPI.commitVoiceDictation({ text })
      setCommitResult(result)
      setStatus('completed')
      setMessage(result.message)
      cleanupAudio()
      setTimeout(() => window.electronAPI.hideVoiceDictation().catch(console.error), 280)
    } catch (error) {
      commitInFlightRef.current = false
      const textMessage = error instanceof Error ? error.message : '未知错误'
      setStatus('error')
      setMessage(`输出失败: ${textMessage}`)
    }
  }, [cleanupAudio])

  const scheduleCommit = React.useCallback((delay: number) => {
    if (commitInFlightRef.current) return
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current)
    }
    commitTimerRef.current = setTimeout(() => {
      commitAndHide().catch(console.error)
    }, delay)
  }, [commitAndHide])

  const stopRecording = React.useCallback(async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    const currentSessionId = sessionIdRef.current
    setStatus('stopping')
    setMessage('正在收尾识别...')
    cleanupAudio(false)
    flushPendingAudio()
    flushQueuedAudio()
    if (currentSessionId && asrReadyRef.current) {
      window.electronAPI.stopVoiceDictation({ sessionId: currentSessionId }).catch(console.error)
    }
    scheduleCommit(STOP_COMMIT_TIMEOUT_MS)
  }, [cleanupAudio, flushPendingAudio, flushQueuedAudio, scheduleCommit])

  const cancelAndHide = React.useCallback(() => {
    stoppingRef.current = true
    const currentSessionId = sessionIdRef.current
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    window.electronAPI.hideVoiceDictation().catch(console.error)
    cleanupAudio()
    if (currentSessionId) {
      window.electronAPI.cancelVoiceDictation({ sessionId: currentSessionId }).catch(console.error)
    }
  }, [cleanupAudio])

  const startAudioCapture = React.useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    streamRef.current = stream

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    const audioContext = new AudioContextCtor()
    audioContextRef.current = audioContext
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    processor.onaudioprocess = (event) => {
      if (!sessionIdRef.current || stoppingRef.current) return
      const input = event.inputBuffer.getChannelData(0)
      let peak = 0
      for (let i = 0; i < input.length; i += 1) {
        peak = Math.max(peak, Math.abs(input[i] ?? 0))
      }
      setVolume(Math.min(1, peak * 4))

      const pcm = floatTo16BitPcm(input, audioContext.sampleRate)
      pendingAudioRef.current.push(pcm)
      let merged = concatAudioBuffers(pendingAudioRef.current)
      const nextPending: ArrayBuffer[] = []
      while (merged.byteLength >= CHUNK_BYTES) {
        const { chunk, rest } = splitChunk(merged, CHUNK_BYTES)
        if (!chunk) break
        sendAudioChunk(sessionIdRef.current, chunk)
        merged = rest
      }
      if (merged.byteLength > 0) nextPending.push(merged)
      pendingAudioRef.current = nextPending
    }

    source.connect(processor)
    processor.connect(audioContext.destination)
  }, [sendAudioChunk])

  const startRecording = React.useCallback(async () => {
    const refreshSettings = window.electronAPI.getVoiceDictationSettings()
      .then((latest) => {
        settingsRef.current = latest
        return latest
      })

    stoppingRef.current = false
    commitInFlightRef.current = false
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    asrReadyRef.current = false
    queuedAudioRef.current = []
    pendingAudioRef.current = []
    setTranscript('')
    transcriptRef.current = ''
    transcriptMergeStateRef.current = {
      committedText: '',
      currentSessionText: '',
      currentSessionId: '',
    }
    setCommitResult(null)
    setStatus('recording')
    setMessage('请开始说话')

    // 预检麦克风权限
    const permission = await window.electronAPI.checkMicrophonePermission()
    if (permission.status === 'denied') {
      setStatus('error')
      setMessage('麦克风权限已被系统阻止，请在系统设置中允许 Proma 访问麦克风')
      return
    }
    if (permission.status === 'not-determined') {
      const requested = await window.electronAPI.requestMicrophonePermission()
      if (requested.status !== 'granted') {
        setStatus('error')
        setMessage('需要麦克风权限才能使用语音输入')
        return
      }
    }

    const nextSessionId = crypto.randomUUID()
    setSessionId(nextSessionId)
    sessionIdRef.current = nextSessionId

    const audioCapture = startAudioCapture().catch((error) => {
      const textMessage = error instanceof Error ? error.message : '未知错误'
      setStatus('error')
      setMessage(textMessage)
      cleanupAudio()
      throw error
    })

    const cachedSettings = settingsRef.current
    const settings = cachedSettings?.enabled ? cachedSettings : await refreshSettings
    settingsRef.current = settings
    if (!settings.enabled) {
      setStatus('error')
      setMessage('请先在设置中启用语音输入')
      cleanupAudio()
      return
    }

    window.electronAPI.startVoiceDictation({ sessionId: nextSessionId })
      .then(() => {
        if (sessionIdRef.current !== nextSessionId) return
        asrReadyRef.current = true
        flushQueuedAudio()
        if (stoppingRef.current) {
          flushPendingAudio()
          flushQueuedAudio()
          window.electronAPI.stopVoiceDictation({ sessionId: nextSessionId }).catch(console.error)
          scheduleCommit(STOP_COMMIT_TIMEOUT_MS)
          return
        }
        setStatus('recording')
        setMessage('正在听写')
      })
      .catch((error) => {
        const textMessage = error instanceof Error ? error.message : '未知错误'
        setStatus('error')
        setMessage(textMessage)
        cleanupAudio()
      })

    await audioCapture
  }, [cleanupAudio, flushPendingAudio, flushQueuedAudio, scheduleCommit, startAudioCapture])

  React.useEffect(() => {
    const cleanupShown = window.electronAPI.onVoiceDictationShown(() => {
      startRecording().catch((error) => {
        const textMessage = error instanceof Error ? error.message : '未知错误'
        setStatus('error')
        setMessage(textMessage)
        cleanupAudio()
      })
    })

    const cleanupStop = window.electronAPI.onVoiceDictationToggleStop(() => {
      stopRecording().catch(console.error)
    })

    const cleanupTranscript = window.electronAPI.onVoiceDictationTranscript((event: VoiceDictationTranscriptEvent) => {
      if (event.sessionId !== sessionIdRef.current) return
      const mergedTranscript = mergeVoiceDictationTranscript(
        transcriptMergeStateRef.current,
        event.text,
        event.isFinal,
        event.sessionId,
      )
      transcriptMergeStateRef.current = mergedTranscript.state
      setTranscript(mergedTranscript.text)
      transcriptRef.current = mergedTranscript.text
      if (stoppingRef.current && event.isFinal) {
        scheduleCommit(FINAL_COMMIT_DELAY_MS)
      }
    })

    const cleanupState = window.electronAPI.onVoiceDictationState((event: VoiceDictationStateEvent) => {
      if (event.sessionId && event.sessionId !== sessionIdRef.current) return
      if (event.status === 'connecting') {
        setStatus('recording')
        return
      }
      // ASR 连接被服务端关闭（VAD 静音超时），如果仍在录音则自动重连
      if (event.status === 'idle' && event.message === 'asr_session_ended' && !stoppingRef.current) {
        const nextSessionId = crypto.randomUUID()
        setSessionId(nextSessionId)
        sessionIdRef.current = nextSessionId
        asrReadyRef.current = false
        queuedAudioRef.current = []
        window.electronAPI.startVoiceDictation({ sessionId: nextSessionId })
          .then(() => {
            if (sessionIdRef.current !== nextSessionId) return
            asrReadyRef.current = true
            flushQueuedAudio()
          })
          .catch((error) => {
            const textMessage = error instanceof Error ? error.message : '未知错误'
            setStatus('error')
            setMessage(textMessage)
          })
        return
      }
      setStatus(event.status)
      if (event.message) setMessage(event.message)
    })

    return () => {
      cleanupShown()
      cleanupStop()
      cleanupTranscript()
      cleanupState()
      const currentSessionId = sessionIdRef.current
      if (currentSessionId) {
        window.electronAPI.cancelVoiceDictation({ sessionId: currentSessionId }).catch(console.error)
      }
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
      cleanupAudio()
    }
  }, [cleanupAudio, flushQueuedAudio, scheduleCommit, startRecording, stopRecording])

  const busy = status === 'connecting' || status === 'recording' || status === 'stopping'
  return (
    <div ref={rootRef} className="box-border flex h-screen w-screen flex-col overflow-hidden rounded-xl bg-background px-2 pt-2 pb-1.5">
      <div ref={panelRef} className="flex min-h-0 w-full flex-col overflow-hidden">
        <div ref={headerRef} className="flex shrink-0 items-center justify-between px-2 pt-0.5 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`relative flex size-8 items-center justify-center rounded-full ${status === 'error' ? 'bg-destructive/12 text-destructive' : 'bg-primary/12 text-primary'}`}
            >
              {status === 'connecting' || status === 'stopping'
                ? <Loader2 className="size-4 animate-spin" />
                : status === 'completed'
                  ? <Check className="size-4" />
                  : status === 'recording'
                    ? (
                      <div className="flex items-center gap-[3px] h-4">
                        {[0.6, 1, 0.75, 0.9, 0.5].map((scale, i) => (
                          <span
                            key={i}
                            className="w-[3px] rounded-full bg-primary transition-all duration-100"
                            style={{ height: `${Math.max(4, Math.round(volume * scale * 16))}px` }}
                          />
                        ))}
                      </div>
                    )
                    : <Mic className="size-4" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">Proma 语音输入</div>
              <div className="truncate text-xs text-muted-foreground">{message}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {busy && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-full text-destructive"
                onClick={() => stopRecording().catch(console.error)}
              >
                <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full text-muted-foreground"
              onClick={cancelAndHide}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 px-2">
          <div className="overflow-hidden rounded-lg bg-muted/45">
            <div ref={hintBarRef} className="flex min-h-8 shrink-0 items-center justify-between gap-3 px-3 py-1.5 text-xs leading-4 text-muted-foreground">
              <span className="truncate">
                Ctrl+～ 停止 · 外部写入光标 · Proma 激活时写入 Chat / Agent
              </span>
              {commitResult && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <Clipboard className="size-3.5" />
                  {commitResult.message}
                </span>
              )}
            </div>
            <div className="h-px bg-border/70" />
            <div
              ref={transcriptBoxRef}
              className="box-border min-h-[34px] px-3 pt-2.5 pb-2.5 text-[15px] leading-7 text-foreground [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              style={{
                maxHeight: transcriptMaxHeight ?? undefined,
                overflowY: 'auto',
              }}
            >
              <div className="whitespace-pre-wrap break-words overflow-hidden">
                {transcript || (
                  <span className="text-muted-foreground/60">
                    {status === 'idle' ? '等待 Ctrl+～ 唤起' : '请开始说话'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
