/**
 * AI Elements - 语音输入按钮
 *
 * 在当前输入工具栏显示听写状态，不创建独立浮窗。
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MicIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { VOICE_DICTATION_STATUS_EVENT } from '@/lib/voice-input-focus'

interface SpeechButtonProps {
  /** @deprecated 语音结果统一由全局语音输入回填到当前输入框 */
  onTranscript?: (text: string) => void
  /** 是否禁用 */
  disabled?: boolean
  className?: string
  /** 所属输入框的语音输入 ID：听写状态与文本回填均固定到该输入框。 */
  voiceInputId: string
}

interface InlineVoiceStatus {
  status: 'idle' | 'connecting' | 'recording' | 'stopping' | 'completed' | 'error'
  message: string
  volume: number
  /** 本次听写会话归属的输入框 ID */
  sourceId?: string | null
}

const IDLE_VOICE_STATUS: InlineVoiceStatus = {
  status: 'idle',
  message: '',
  volume: 0,
}

export function SpeechButton({
  disabled = false,
  className,
  voiceInputId,
}: SpeechButtonProps): React.ReactElement {
  const [voiceStatus, setVoiceStatus] = useState<InlineVoiceStatus>(IDLE_VOICE_STATUS)
  const isRecording = voiceStatus.status === 'recording'
  const isPreparing = voiceStatus.status === 'connecting'
  const isStopping = voiceStatus.status === 'stopping'
  const isActive = isPreparing || isRecording || isStopping

  useEffect(() => {
    const handleStatus = (event: Event): void => {
      const detail = (event as CustomEvent<Partial<InlineVoiceStatus>>).detail
      if (!detail?.status) return
      // 整个会话状态只归属到发起听写的输入框；其他按钮始终保持 idle，
      // 避免多个输入框同时显示听写或终态反馈。
      if (detail.sourceId !== voiceInputId) {
        setVoiceStatus(IDLE_VOICE_STATUS)
        return
      }
      setVoiceStatus({
        status: detail.status,
        message: detail.message ?? '',
        volume: detail.volume ?? 0,
      })
    }
    window.addEventListener(VOICE_DICTATION_STATUS_EVENT, handleStatus)
    return () => window.removeEventListener(VOICE_DICTATION_STATUS_EVENT, handleStatus)
  }, [voiceInputId])

  const handleClick = useCallback((): void => {
    void (async () => {
      try {
        const settings = await window.electronAPI.getVoiceDictationSettings()
        if (!settings.enabled) {
          toast.info('请先在设置中打开语音输入开关')
          return
        }

        // 主进程只会在真正开始新会话时采用来源 ID；若当前会话仍在录音，点击其他按钮仅触发停止，
        // 不会改写已经冻结的文本回填目标。
        await window.electronAPI.toggleVoiceDictation({ sourceInputId: voiceInputId })
      } catch (error) {
        console.error('[语音输入] 切换听写状态失败:', error)
        toast.error('切换语音输入失败')
      }
    })()
  }, [voiceInputId])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-w-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'relative size-8 transition-all duration-200 text-foreground/60 hover:text-foreground',
              isActive && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
              className
            )}
            onClick={handleClick}
            disabled={disabled}
            aria-label={isActive ? '停止语音输入' : '开始语音输入'}
          >
            {isPreparing || isStopping ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isRecording ? (
              <span className="flex h-4 items-center gap-[2px]" aria-hidden="true">
                {[0.6, 1, 0.75, 0.9].map((scale, index) => (
                  <span
                    key={index}
                    className="w-[2px] rounded-full bg-current transition-[height] duration-100"
                    style={{ height: `${Math.max(4, Math.round(voiceStatus.volume * scale * 16))}px` }}
                  />
                ))}
              </span>
            ) : (
              <MicIcon className="size-4" />
            )}
          </Button>
          {isActive && (
            <span className="max-w-20 truncate text-xs text-primary" role="status">
              {isPreparing ? '准备麦克风' : isStopping ? '收尾中' : '正在听写'}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{isActive ? voiceStatus.message || '正在听写' : '语音输入'}</p>
      </TooltipContent>
    </Tooltip>
  )
}
