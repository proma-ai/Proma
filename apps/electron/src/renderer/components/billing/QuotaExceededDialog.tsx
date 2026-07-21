/**
 * QuotaExceededDialog - 额度不足弹窗
 *
 * 402 响应时弹出，引导用户查看使用额度
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
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
import { quotaExceededDialogAtom } from '@/atoms/cloud-billing'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'

export function QuotaExceededDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(quotaExceededDialogAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  const handleRecharge = (): void => {
    setOpen(false)
    setSettingsTab('billing')
    setSettingsOpen(true)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Proma Cloud 额度不足</AlertDialogTitle>
          <AlertDialogDescription>
            当前官方额度不足。购买额度后可继续使用 Proma Cloud 的模型、Agent 与云端工具。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={handleRecharge}>
            查看使用额度
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
