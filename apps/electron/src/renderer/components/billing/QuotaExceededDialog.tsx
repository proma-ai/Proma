/**
 * QuotaExceededDialog - 额度不足弹窗
 *
 * 402 响应时弹出，引导用户去充值
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
import { activeViewAtom } from '@/atoms/active-view'
import { settingsTabAtom } from '@/atoms/settings-tab'

export function QuotaExceededDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(quotaExceededDialogAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  const handleRecharge = (): void => {
    setOpen(false)
    setSettingsTab('billing')
    setActiveView('settings')
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>额度已用完</AlertDialogTitle>
          <AlertDialogDescription>
            您的使用额度已耗尽，请充值后继续使用
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={handleRecharge}>
            去充值
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
