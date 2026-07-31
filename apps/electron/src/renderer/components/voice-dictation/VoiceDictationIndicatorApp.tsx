/** Lightweight, non-focusable voice state for dictation into another application. */

import * as React from 'react'
import { Loader2, Mic } from 'lucide-react'

export function VoiceDictationIndicatorApp(): React.ReactElement {
  const [state, setState] = React.useState<'recording' | 'stopping'>('recording')
  const [volume, setVolume] = React.useState(0)
  const [transcript, setTranscript] = React.useState('')
  const [typedTranscript, setTypedTranscript] = React.useState('')

  React.useEffect(() => {
    return window.electronAPI.onVoiceDictationIndicatorState((event) => {
      setState(event.state)
      setVolume(event.volume)
      setTranscript(event.transcript)
    })
  }, [])

  React.useEffect(() => {
    if (typedTranscript === transcript) return

    const timer = window.setTimeout(() => {
      setTypedTranscript((current) => {
        if (current === transcript) return transcript
        // 豆包偶尔会修订前面的分词，无法安全地逐字追加时立即对齐最新结果。
        if (!transcript.startsWith(current)) return transcript
        return transcript.slice(0, Math.min(transcript.length, current.length + 2))
      })
    }, 18)
    return () => window.clearTimeout(timer)
  }, [transcript, typedTranscript])

  const stopping = state === 'stopping'
  const lines = getRecentTranscriptLines(typedTranscript)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-border/70 bg-background/95 px-4 py-2.5 text-foreground shadow-lg backdrop-blur">
      <div className="flex shrink-0 items-center justify-center gap-2 text-xs font-medium">
        <span className="flex size-5 items-center justify-center text-primary" aria-hidden="true">
          {stopping ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <span className="flex h-4 items-center gap-[2px]">
              {[0.65, 1, 0.78, 0.9].map((scale, index) => (
                <span
                  key={index}
                  className="w-[2px] rounded-full bg-current transition-[height] duration-100 ease-out"
                  style={{
                    height: `${Math.max(3, Math.round((3 + volume * 11) * scale))}px`,
                    animationDelay: `${index * 80}ms`,
                  }}
                />
              ))}
            </span>
          )}
        </span>
        <span>{stopping ? '正在整理语音' : '正在听写'}</span>
        <Mic className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </div>

      <div
        className="mt-2 min-h-0 flex-1 overflow-hidden text-center text-xs leading-5 text-foreground/85"
        style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 84%, transparent 100%)' }}
        aria-live="polite"
      >
        {lines.length > 0 ? (
          <div className="animate-in fade-in slide-in-from-bottom-1 duration-200">
            {lines.map((line, index) => (
              <p key={`${index}-${line}`} className={index === 0 && lines.length > 1 ? 'truncate text-muted-foreground/70' : 'truncate'}>
                {line}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground/60">请开始说话</p>
        )}
      </div>
    </div>
  )
}

function getRecentTranscriptLines(transcript: string): string[] {
  const segments = transcript.match(/[^。！？!?；;，,、\n]+[。！？!?；;，,、\n]*/g) ?? []
  const lines = segments.map((segment) => segment.trim()).filter(Boolean)
  if (lines.length > 0) return lines.slice(-2)
  return transcript.trim() ? [transcript.trim()] : []
}
