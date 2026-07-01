/**
 * ClearContextButton - 清除上下文按钮
 *
 * Eraser 图标 + tooltip 含 Cmd/Ctrl+K 快捷键提示。
 * 移植自 proma-frontend 的 chat-view/clear-context-button.tsx。
 */

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { inputToolbarButtonClass } from '@/components/ai-elements/input-toolbar-styles'
import { Eraser } from 'lucide-react'
import type { ComponentProps } from 'react'

export interface ClearContextButtonProps
  extends Omit<ComponentProps<typeof Button>, 'onClick'> {
  /** 点击回调 */
  onClick?: () => void
}

export function ClearContextButton({
  onClick,
  className,
  ...props
}: ClearContextButtonProps): React.ReactElement {
  // 检测平台以显示正确的快捷键
  const isMac =
    typeof navigator !== 'undefined' &&
    navigator.platform.toLowerCase().includes('mac')
  const shortcutKey = isMac ? '⌘K' : 'Ctrl+K'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(inputToolbarButtonClass, className)}
          onClick={onClick}
          aria-label="清除上下文"
          {...props}
        >
          <Eraser className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>清除上下文 ({shortcutKey})</p>
      </TooltipContent>
    </Tooltip>
  )
}
