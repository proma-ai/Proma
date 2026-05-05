/**
 * AI Elements - 语音输入按钮
 *
 * 通过主进程唤起系统级豆包流式语音输入浮窗。
 */

import { useCallback } from 'react'
import { MicIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface SpeechButtonProps {
  /** @deprecated 语音结果统一由全局语音输入回填到当前输入框 */
  onTranscript?: (text: string) => void
  /** 是否禁用 */
  disabled?: boolean
  className?: string
}

export function SpeechButton({
  disabled = false,
  className,
}: SpeechButtonProps): React.ReactElement {
  const handleClick = useCallback((): void => {
    window.electronAPI.toggleVoiceDictation().catch((error) => {
      console.error('[语音输入] 唤起浮窗失败:', error)
    })
  }, [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-8 transition-all duration-200 text-foreground/60 hover:text-foreground',
            className
          )}
          onClick={handleClick}
          disabled={disabled}
        >
          <MicIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>语音输入</p>
      </TooltipContent>
    </Tooltip>
  )
}
