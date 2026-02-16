/**
 * AI Elements - 语音输入按钮
 *
 * 使用 Web Speech API（Electron Chromium 原生支持）。
 * 如果 SpeechRecognition 不可用则不渲染。
 *
 * 功能：
 * - 点击开始/停止录音
 * - 录音中 animate-pulse 红色效果
 * - 中文语音识别 (zh-CN)
 * - 识别结果通过 onTranscript 回调返回
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { MicIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** SpeechRecognition 接口（Chromium 实现） */
interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionResultEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  length: number
  item: (index: number) => SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  length: number
  item: (index: number) => SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

/** 获取 SpeechRecognition 构造函数 */
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  const win = window as unknown as Record<string, unknown>
  return (win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionInstance)
    | null
}

interface SpeechButtonProps {
  /** 识别结果回调 */
  onTranscript: (text: string) => void
  /** 是否禁用 */
  disabled?: boolean
  className?: string
}

export function SpeechButton({
  onTranscript,
  disabled = false,
  className,
}: SpeechButtonProps): React.ReactElement | null {
  const [isRecording, setIsRecording] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  // 检测 SpeechRecognition 是否可用
  const SpeechRecognitionCtor = getSpeechRecognition()

  // 清理录音实例
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
    }
  }, [])

  const handleClick = useCallback(() => {
    if (isRecording) {
      // 停止录音
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    if (!SpeechRecognitionCtor) return

    // 开始录音
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (event: SpeechRecognitionResultEvent) => {
      const result = event.results[event.resultIndex]
      if (result?.isFinal) {
        const transcript = result[0]?.transcript
        if (transcript) {
          onTranscriptRef.current(transcript)
        }
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[SpeechButton] 语音识别错误:', event.error)
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }, [isRecording, SpeechRecognitionCtor])

  // SpeechRecognition 不可用时不渲染
  if (!SpeechRecognitionCtor) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-8 transition-all duration-200',
            isRecording && 'animate-pulse bg-red-500 text-white hover:bg-red-600',
            className
          )}
          onClick={handleClick}
          disabled={disabled}
        >
          <MicIcon className="size-4" />
          {isRecording && (
            <span className="absolute -right-1 -top-1 flex size-3">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-3 rounded-full bg-red-500" />
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{isRecording ? '停止录音' : '语音输入'}</p>
      </TooltipContent>
    </Tooltip>
  )
}
