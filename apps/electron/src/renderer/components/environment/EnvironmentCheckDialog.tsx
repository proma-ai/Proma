/**
 * Windows 环境检测 Dialog
 *
 * 聊天里的错误卡片「打开环境检测」按钮 / 设置页入口都会打开它，
 * 复用 EnvironmentCheckPanel。
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EnvironmentCheckPanel } from './EnvironmentCheckPanel'

interface EnvironmentCheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EnvironmentCheckDialog({ open, onOpenChange }: EnvironmentCheckDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>环境检测</DialogTitle>
          <DialogDescription>
            检查并修复 Proma 运行所需的 Windows 本地环境
          </DialogDescription>
        </DialogHeader>
        <EnvironmentCheckPanel autoDetectOnMount={open} />
      </DialogContent>
    </Dialog>
  )
}
