/**
 * VoiceDictationApp — 系统级语音输入浮窗
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Check, Clipboard, Loader2, Mic, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VoiceDictationCommitResult, VoiceDictationSettings, VoiceDictationStateEvent, VoiceDictationTranscriptEvent } from '../../../types'
import { CHUNK_BYTES, concatAudioBuffers, floatTo16BitPcm, splitChunk } from './voice-audio-utils'
import { mergeVoiceDictationTranscript } from './voice-transcript-merge'
import type { VoiceDictationTranscriptMergeState } from './voice-transcript-merge'
import { useVoiceWindowLayout } from './use-voice-window-layout'
import { resumeAudioContextForCapture } from './audio-context'
import {
  VOICE_DICTATION_STATUS_EVENT,
  resolveVoiceDictationSessionInputIds,
  setLastFocusedVoiceInputId,
} from '@/lib/voice-input-focus'

const MAX_QUEUED_CHUNKS = 60
const STOP_COMMIT_TIMEOUT_MS = 1400
const FINAL_COMMIT_DELAY_MS = 180

export function VoiceDictationApp({ embedded = false }: { embedded?: boolean }): React.ReactElement {
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<VoiceDictationStateEvent['status']>('idle')
  const [message, setMessage] = React.useState('按快捷键开始语音输入')
  const [transcript, setTranscript] = React.useState('')
  const [commitResult, setCommitResult] = React.useState<VoiceDictationCommitResult | null>(null)
  const [volume, setVolume] = React.useState(0)
  const [dictationSourceId, setDictationSourceId] = React.useState<string | null>(null)

  const sessionIdRef = React.useRef<string | null>(null)
  const transcriptRef = React.useRef('')
  const transcriptMergeStateRef = React.useRef<VoiceDictationTranscriptMergeState>({
    committedText: '',
    currentSessionText: '',
    currentSessionId: '',
  })
  const streamRef = React.useRef<MediaStream | null>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = React.useRef<ScriptProcessorNode | null>(null)
  const pendingAudioRef = React.useRef<ArrayBuffer[]>([])
  const queuedAudioRef = React.useRef<ArrayBuffer[]>([])
  const asrReadyRef = React.useRef(false)
  const stoppingRef = React.useRef(false)
  const settingsRef = React.useRef<VoiceDictationSettings | null>(null)
  const commitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitInFlightRef = React.useRef(false)
  const previewTextRef = React.useRef('')
  const dictationIdRef = React.useRef<string | null>(null)
  const recordingAttemptRef = React.useRef(0)
  const audioCaptureReadyRef = React.useRef(false)
  const lastReportedVolumeAtRef = React.useRef(0)
  /** 本次听写会话归属的输入框 ID，仅用于同步内嵌按钮状态。 */
  const dictationSourceRef = React.useRef<string | null>(null)
  /** 本次听写会话冻结的文本回填目标；复制到剪贴板时明确为 null。 */
  const dictationTargetRef = React.useRef<string | null>(null)
  /** 主进程生成的输出上下文 ID，确保录音期间修改设置不会改变输出去向。 */
  const dictationOutputContextRef = React.useRef<string | null>(null)
  /** 取消或提交后拒绝同一 ASR 会话的迟到 transcript/state 事件。 */
  const discardTranscriptRef = React.useRef(false)

  const setDictationSource = React.useCallback((sourceId: string | null) => {
    dictationSourceRef.current = sourceId
    setDictationSourceId(sourceId)
  }, [])

  const setDictationTarget = React.useCallback((targetInputId: string | null) => {
    dictationTargetRef.current = targetInputId
  }, [])

  const setDictationOutputContext = React.useCallback((outputContextId: string | null) => {
    dictationOutputContextRef.current = outputContextId
  }, [])

  const discardCurrentTranscript = React.useCallback(() => {
    discardTranscriptRef.current = true
    sessionIdRef.current = null
    dictationIdRef.current = null
  }, [])

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

  React.useEffect(() => {
    if (!embedded) return
    window.dispatchEvent(new CustomEvent(VOICE_DICTATION_STATUS_EVENT, {
      detail: { status, message, volume, sourceId: dictationSourceId },
    }))
  }, [dictationSourceId, embedded, message, status, volume])

  const cleanupAudio = React.useCallback((clearBufferedAudio = true) => {
    processorRef.current?.disconnect()
    processorRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (clearBufferedAudio) {
      pendingAudioRef.current = []
      queuedAudioRef.current = []
      asrReadyRef.current = false
      audioCaptureReadyRef.current = false
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
    const asrSessionId = sessionIdRef.current
    const dictationSessionId = dictationIdRef.current
    const targetInputId = dictationTargetRef.current
    const outputContextId = dictationOutputContextRef.current
    discardCurrentTranscript()
    if (!text) {
      setStatus('idle')
      setMessage('没有识别到语音内容')
      setDictationSource(null)
      setDictationTarget(null)
      setDictationOutputContext(null)
      cleanupAudio()
      if (asrSessionId) {
        window.electronAPI.cancelVoiceDictation({
          sessionId: asrSessionId,
          previewSessionId: dictationSessionId ?? undefined,
          targetInputId,
          outputContextId: outputContextId ?? undefined,
        }).catch(console.error)
      }
      setTimeout(() => window.electronAPI.hideVoiceDictation().catch(console.error), 180)
      return
    }

    setStatus('stopping')
    setMessage('正在输出文本...')
    try {
      const result = await window.electronAPI.commitVoiceDictation({
        sessionId: dictationSessionId ?? asrSessionId ?? '',
        text,
        targetInputId,
        outputContextId: outputContextId ?? undefined,
      })
      setCommitResult(result)
      setStatus('completed')
      setMessage(result.message)
      if (embedded && targetInputId && result.mode === 'clipboard') {
        const notify = result.success ? toast.warning : toast.error
        notify(result.message)
      }
      setDictationSource(null)
      setDictationTarget(null)
      setDictationOutputContext(null)
      cleanupAudio()
      setTimeout(() => window.electronAPI.hideVoiceDictation().catch(console.error), 280)
    } catch (error) {
      commitInFlightRef.current = false
      const textMessage = error instanceof Error ? error.message : '未知错误'
      setStatus('error')
      setMessage(`输出失败: ${textMessage}`)
    }
  }, [cleanupAudio, discardCurrentTranscript, setDictationOutputContext, setDictationSource, setDictationTarget])

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
    if (currentSessionId) {
      window.electronAPI.stopVoiceDictation({ sessionId: currentSessionId }).catch(console.error)
    }
    scheduleCommit(STOP_COMMIT_TIMEOUT_MS)
  }, [cleanupAudio, flushPendingAudio, flushQueuedAudio, scheduleCommit])

  const cancelAndHide = React.useCallback(() => {
    if (commitInFlightRef.current) return
    recordingAttemptRef.current += 1
    stoppingRef.current = true
    const currentSessionId = sessionIdRef.current
    const dictationSessionId = dictationIdRef.current
    const targetInputId = dictationTargetRef.current
    const outputContextId = dictationOutputContextRef.current
    discardCurrentTranscript()
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    setStatus('idle')
    setMessage('已取消语音输入')
    setDictationSource(null)
    setDictationTarget(null)
    setDictationOutputContext(null)
    window.electronAPI.hideVoiceDictation().catch(console.error)
    cleanupAudio()
    if (currentSessionId) {
      window.electronAPI.cancelVoiceDictation({
        sessionId: currentSessionId,
        previewSessionId: dictationSessionId ?? undefined,
        targetInputId,
        outputContextId: outputContextId ?? undefined,
      }).catch(console.error)
    }
  }, [cleanupAudio, discardCurrentTranscript, setDictationOutputContext, setDictationSource, setDictationTarget])

  React.useEffect(() => {
    if (status !== 'connecting' && status !== 'recording' && status !== 'stopping') return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelAndHide()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [cancelAndHide, status])

  const abortCurrentSession = React.useCallback(() => {
    recordingAttemptRef.current += 1
    stoppingRef.current = true
    const currentSessionId = sessionIdRef.current
    const dictationSessionId = dictationIdRef.current
    const targetInputId = dictationTargetRef.current
    const outputContextId = dictationOutputContextRef.current
    discardCurrentTranscript()
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    cleanupAudio()
    setDictationSource(null)
    setDictationTarget(null)
    setDictationOutputContext(null)
    if (currentSessionId) {
      window.electronAPI.cancelVoiceDictation({
        sessionId: currentSessionId,
        previewSessionId: dictationSessionId ?? undefined,
        targetInputId,
        outputContextId: outputContextId ?? undefined,
      }).catch(console.error)
    }
    window.electronAPI.hideVoiceDictation().catch(console.error)
  }, [cleanupAudio, discardCurrentTranscript, setDictationOutputContext, setDictationSource, setDictationTarget])

  React.useEffect(() => {
    if (status !== 'error') return
    abortCurrentSession()
  }, [abortCurrentSession, status])

  const requestMicrophoneStream = React.useCallback(async (): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持麦克风采集')
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
      })
    } catch (error) {
      if (isConstraintError(error)) {
        return navigator.mediaDevices.getUserMedia({ audio: true })
      }
      throw error
    }
  }, [])

  const markAudioCaptureReady = React.useCallback(() => {
    if (audioCaptureReadyRef.current) return
    audioCaptureReadyRef.current = true
    setStatus('recording')
    setMessage('正在听写')
  }, [])

  const startAudioCapture = React.useCallback(async (attempt: number) => {
    const stream = await requestMicrophoneStream()
    if (attempt !== recordingAttemptRef.current || stoppingRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    streamRef.current = stream

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) {
      throw new Error('当前环境不支持音频处理')
    }

    const audioContext = new AudioContextCtor()
    if (attempt !== recordingAttemptRef.current || stoppingRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      await audioContext.close().catch(() => {})
      return
    }
    audioContextRef.current = audioContext
    const source = audioContext.createMediaStreamSource(stream)
    sourceRef.current = source
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    processor.onaudioprocess = (event) => {
      if (!sessionIdRef.current || stoppingRef.current) return
      const input = event.inputBuffer.getChannelData(0)
      let peak = 0
      for (let i = 0; i < input.length; i += 1) {
        peak = Math.max(peak, Math.abs(input[i] ?? 0))
      }
      const normalizedVolume = Math.min(1, peak * 4)
      setVolume(normalizedVolume)
      const now = performance.now()
      if (now - lastReportedVolumeAtRef.current >= 80) {
        lastReportedVolumeAtRef.current = now
        window.electronAPI.reportVoiceDictationVolume(normalizedVolume)
      }

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
    await resumeAudioContextForCapture(audioContext)
    if (!stream.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled)) {
      throw new Error('麦克风未就绪，请检查系统麦克风权限与设备连接')
    }

    // getUserMedia 已授予并启用音轨，且音频图已恢复即可认定采集就绪。
    // 不再依赖首个 ScriptProcessor 回调：某些系统/设备会延后该回调，导致
    // 实际已打开的麦克风永久停在“准备麦克风”。
    if (attempt === recordingAttemptRef.current && !stoppingRef.current) {
      markAudioCaptureReady()
    }
  }, [markAudioCaptureReady, requestMicrophoneStream, sendAudioChunk])

  const startRecording = React.useCallback(async () => {
    const refreshSettings = window.electronAPI.getVoiceDictationSettings()
      .then((latest) => {
        settingsRef.current = latest
        return latest
      })
      .catch((error) => {
        if (settingsRef.current?.enabled) {
          console.warn('[语音输入] 刷新设置失败，继续使用已缓存设置:', error)
          return settingsRef.current
        }
        throw error
      })

    stoppingRef.current = false
    discardTranscriptRef.current = false
    commitInFlightRef.current = false
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    asrReadyRef.current = false
    audioCaptureReadyRef.current = false
    lastReportedVolumeAtRef.current = 0
    queuedAudioRef.current = []
    pendingAudioRef.current = []
    setTranscript('')
    transcriptRef.current = ''
    previewTextRef.current = ''
    transcriptMergeStateRef.current = {
      committedText: '',
      currentSessionText: '',
      currentSessionId: '',
    }
    setCommitResult(null)
    setStatus('connecting')
    setMessage('准备麦克风...')
    const recordingAttempt = ++recordingAttemptRef.current

    const isCurrentAttempt = (): boolean => recordingAttempt === recordingAttemptRef.current
    const shouldBeginRecording = (): boolean => isCurrentAttempt() && !stoppingRef.current
    const cachedSettings = settingsRef.current
    const settings = cachedSettings?.enabled ? cachedSettings : await refreshSettings
    if (!shouldBeginRecording()) return
    settingsRef.current = settings
    if (!settings.enabled) {
      setStatus('error')
      setMessage('请先在设置中启用语音输入')
      cleanupAudio()
      return
    }

    // 预检麦克风权限
    const permission = await window.electronAPI.checkMicrophonePermission()
    if (!shouldBeginRecording()) return
    if (permission.status === 'denied') {
      setStatus('error')
      setMessage('麦克风权限已被系统阻止，请在系统设置中允许 Proma 访问麦克风')
      return
    }
    if (permission.status === 'not-determined') {
      const requested = await window.electronAPI.requestMicrophonePermission()
      if (!shouldBeginRecording()) return
      if (requested.status !== 'granted') {
        setStatus('error')
        setMessage('需要麦克风权限才能使用语音输入')
        return
      }
    }

    if (!shouldBeginRecording()) return
    const nextSessionId = crypto.randomUUID()
    const nextDictationId = crypto.randomUUID()
    dictationIdRef.current = nextDictationId
    setSessionId(nextSessionId)
    sessionIdRef.current = nextSessionId

    const audioCapture = startAudioCapture(recordingAttempt).catch((error) => {
      if (!isCurrentAttempt()) return
      const textMessage = getMicrophoneErrorMessage(error)
      setStatus('error')
      setMessage(textMessage)
      abortCurrentSession()
      throw error
    })

    window.electronAPI.startVoiceDictation({ sessionId: nextSessionId })
      .then(() => {
        if (!isCurrentAttempt() || sessionIdRef.current !== nextSessionId) {
          window.electronAPI.cancelVoiceDictation({ sessionId: nextSessionId }).catch(console.error)
          return
        }
        asrReadyRef.current = true
        flushQueuedAudio()
        if (stoppingRef.current) {
          flushPendingAudio()
          flushQueuedAudio()
          window.electronAPI.stopVoiceDictation({ sessionId: nextSessionId }).catch(console.error)
          scheduleCommit(STOP_COMMIT_TIMEOUT_MS)
          return
        }
      })
      .catch((error) => {
        if (!isCurrentAttempt() || sessionIdRef.current !== nextSessionId || stoppingRef.current) return
        const textMessage = error instanceof Error ? error.message : '未知错误'
        setStatus('error')
        setMessage(textMessage)
        abortCurrentSession()
      })

    await audioCapture
  }, [abortCurrentSession, cleanupAudio, flushPendingAudio, flushQueuedAudio, scheduleCommit, startAudioCapture])

  React.useEffect(() => {
    const cleanupShown = window.electronAPI.onVoiceDictationShown((event) => {
      // 主进程已冻结本次输出是否路由到 Proma；点击按钮的来源仍应保留给 UI，
      // 即使用户选择复制到剪贴板。快捷键仅在需要写入 Proma 时回退到最后聚焦输入框。
      const { sourceInputId, targetInputId } = resolveVoiceDictationSessionInputIds(
        event.routeToPromaInput,
        event.sourceInputId,
      )
      if (sourceInputId) setLastFocusedVoiceInputId(sourceInputId)
      setDictationSource(sourceInputId)
      setDictationTarget(targetInputId)
      setDictationOutputContext(event.outputContextId)
      startRecording().catch((error) => {
        const textMessage = getMicrophoneErrorMessage(error)
        setStatus('error')
        setMessage(textMessage)
        toast.error(textMessage)
        cleanupAudio()
      })
    })

    const cleanupStop = window.electronAPI.onVoiceDictationToggleStop(() => {
      stopRecording().catch(console.error)
    })

    const cleanupTranscript = window.electronAPI.onVoiceDictationTranscript((event: VoiceDictationTranscriptEvent) => {
      if (discardTranscriptRef.current || event.sessionId !== sessionIdRef.current) return
      const mergedTranscript = mergeVoiceDictationTranscript(
        transcriptMergeStateRef.current,
        event.text,
        event.isFinal,
        event.sessionId,
      )
      transcriptMergeStateRef.current = mergedTranscript.state
      setTranscript(mergedTranscript.text)
      transcriptRef.current = mergedTranscript.text
      window.electronAPI.reportVoiceDictationTranscript(mergedTranscript.text)
      if (mergedTranscript.text !== previewTextRef.current) {
        previewTextRef.current = mergedTranscript.text
        window.electronAPI.previewVoiceDictation({
          sessionId: dictationIdRef.current ?? event.sessionId,
          text: mergedTranscript.text,
          targetInputId: dictationTargetRef.current,
          outputContextId: dictationOutputContextRef.current ?? undefined,
        }).catch(console.error)
      }
      if (stoppingRef.current && event.isFinal) {
        scheduleCommit(FINAL_COMMIT_DELAY_MS)
      }
    })

    const cleanupState = window.electronAPI.onVoiceDictationState((event: VoiceDictationStateEvent) => {
      if (event.sessionId && event.sessionId !== sessionIdRef.current) return
      if (stoppingRef.current && event.status === 'error') return
      if (event.status === 'connecting' || event.status === 'recording') {
        if (!audioCaptureReadyRef.current) {
          setStatus('connecting')
          setMessage('准备麦克风...')
        }
        return
      }
      if (event.status === 'idle' && event.message === 'asr_session_ended') {
        if (stoppingRef.current) return
        // ASR 连接被服务端关闭（VAD 静音超时），如果仍在录音则自动重连。
        // 捕获当前 attempt，避免 Escape、停止或卸载后的异步握手重新激活已取消会话。
        const reconnectAttempt = recordingAttemptRef.current
        const nextSessionId = crypto.randomUUID()
        const isCurrentReconnect = (): boolean =>
          recordingAttemptRef.current === reconnectAttempt &&
          sessionIdRef.current === nextSessionId
        setSessionId(nextSessionId)
        sessionIdRef.current = nextSessionId
        asrReadyRef.current = false
        queuedAudioRef.current = []
        window.electronAPI.startVoiceDictation({ sessionId: nextSessionId })
          .then(() => {
            if (!isCurrentReconnect()) {
              window.electronAPI.cancelVoiceDictation({ sessionId: nextSessionId }).catch(console.error)
              return
            }
            asrReadyRef.current = true
            flushQueuedAudio()
            if (stoppingRef.current) {
              window.electronAPI.stopVoiceDictation({ sessionId: nextSessionId }).catch(console.error)
              scheduleCommit(STOP_COMMIT_TIMEOUT_MS)
            }
          })
          .catch((error) => {
            if (!isCurrentReconnect() || stoppingRef.current) return
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
      recordingAttemptRef.current += 1
      const currentSessionId = sessionIdRef.current
      const dictationSessionId = dictationIdRef.current
      const targetInputId = dictationTargetRef.current
      const outputContextId = dictationOutputContextRef.current
      discardCurrentTranscript()
      if (currentSessionId) {
        window.electronAPI.cancelVoiceDictation({
          sessionId: currentSessionId,
          previewSessionId: dictationSessionId ?? undefined,
          targetInputId,
          outputContextId: outputContextId ?? undefined,
        }).catch(console.error)
      }
      setDictationSource(null)
      setDictationTarget(null)
      setDictationOutputContext(null)
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
      cleanupAudio()
      window.electronAPI.hideVoiceDictation().catch(console.error)
    }
  }, [cleanupAudio, discardCurrentTranscript, flushQueuedAudio, scheduleCommit, setDictationOutputContext, setDictationSource, setDictationTarget, startRecording, stopRecording])

  const busy = status === 'connecting' || status === 'recording' || status === 'stopping'
  if (embedded) return <span className="hidden" aria-hidden="true" />

  return (
    <div ref={rootRef} className="box-border flex h-screen w-screen flex-col overflow-hidden rounded-xl bg-background px-2 pt-2 pb-1.5">
      <div ref={panelRef} className="flex min-h-0 w-full flex-col overflow-hidden">
        <div ref={headerRef} className="voice-dictation-drag-region flex shrink-0 items-center justify-between px-2 pt-0.5 pb-2">
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

          <div className="voice-dictation-no-drag flex items-center gap-1.5">
            {busy && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="voice-dictation-no-drag size-8 rounded-full text-destructive"
                onClick={() => stopRecording().catch(console.error)}
              >
                <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="voice-dictation-no-drag size-8 rounded-full text-muted-foreground"
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
                    {status === 'idle'
                      ? '等待 Ctrl+～ 唤起'
                      : status === 'connecting'
                        ? '准备麦克风...'
                        : '请开始说话'}
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

function isConstraintError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError')
}

function getMicrophoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return '麦克风权限被系统阻止，请在 Windows 设置 > 隐私和安全性 > 麦克风中允许 Proma 访问'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '没有检测到可用麦克风，请检查输入设备是否已连接并启用'
      case 'NotReadableError':
      case 'TrackStartError':
        return '麦克风当前无法读取，可能被其他应用占用或被系统隐私设置阻止'
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return '当前麦克风不支持请求的采集参数，请切换输入设备后重试'
      case 'SecurityError':
        return '当前窗口被系统阻止访问麦克风，请检查应用权限设置'
      default:
        break
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return '未知麦克风错误'
}
