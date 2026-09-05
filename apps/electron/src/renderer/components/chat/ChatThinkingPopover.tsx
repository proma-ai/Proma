import * as React from 'react'
import { Brain } from 'lucide-react'
import { getGeminiModelCapability, type GeminiThinkingLevel } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { inputToolbarActiveButtonClass, inputToolbarButtonClass } from '@/components/ai-elements/input-toolbar-styles'
import { useConversationThinkingEnabled, useConversationThinkingLevel } from '@/hooks/useConversationSettings'
import { cn } from '@/lib/utils'

const THINKING_LEVEL_LABELS: Record<GeminiThinkingLevel, string> = {
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
}

interface ChatThinkingPopoverProps {
  modelId?: string
}

/**
 * Chat 的思考设置。仅 Gemini 3 文本模型显示其官方支持的深度；其他模型仍保留原有开关。
 * 设置只写入当前对话 atom，不订阅流式内容或增加 IPC。
 */
export function ChatThinkingPopover({ modelId }: ChatThinkingPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useConversationThinkingEnabled()
  const [thinkingLevel, setThinkingLevel] = useConversationThinkingLevel()
  const capability = getGeminiModelCapability(modelId)
  const effectiveLevel = capability?.thinkingLevels.includes(thinkingLevel)
    ? thinkingLevel
    : capability?.defaultThinkingLevel

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(inputToolbarButtonClass, thinkingEnabled && inputToolbarActiveButtonClass)}
          aria-label="思考设置"
        >
          <Brain className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={8} className="w-56 space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">思考模式</p>
            <p className="text-xs text-muted-foreground">{thinkingEnabled ? '已启用' : '已关闭'}</p>
          </div>
          <Switch checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} aria-label="启用思考模式" />
        </div>
        {capability && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Gemini 思考深度</p>
            <div className="grid grid-cols-2 gap-1">
              {capability.thinkingLevels.map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant={effectiveLevel === level ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 justify-start px-2 text-xs"
                  disabled={!thinkingEnabled}
                  onClick={() => setThinkingLevel(level)}
                >
                  {THINKING_LEVEL_LABELS[level]}
                </Button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              当前模型默认：{THINKING_LEVEL_LABELS[capability.defaultThinkingLevel]}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
