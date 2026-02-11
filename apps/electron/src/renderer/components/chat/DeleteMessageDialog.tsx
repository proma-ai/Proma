/**
 * DeleteMessageDialog - 删除消息确认对话框
 *
 * AlertDialog 确认删除，黄色警告提示建议成对删除。
 * 移植自 proma-frontend 的 chat-view/delete-message-dialog.tsx。
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface DeleteMessageDialogProps {
  /** 是否显示 */
  open: boolean
  /** 显示状态变更 */
  onOpenChange: (open: boolean) => void
  /** 确认删除回调 */
  onConfirm: () => void
  /** 是否正在删除 */
  isDeleting?: boolean
}

export function DeleteMessageDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting = false,
}: DeleteMessageDialogProps): React.ReactElement {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>删除后无法恢复。</p>
              <p className="text-yellow-600 dark:text-yellow-500">
                提示：建议同时删除对话对（用户消息和对应的助手回复），否则可能因数据结构变化导致模型无法正常返回对话。
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {isDeleting ? '删除中...' : '删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
