/**
 * LowCreditReminder - Cloud 额度分级充值提醒
 *
 * 在余额首次降至 20、10、5、2 积分时各提示一次；充值后再次跨过阈值时可重新提醒。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { calcTotalAvailable } from '@proma/shared'
import { billingInfoAtom } from '@/atoms/cloud-billing'
import { cloudUserAtom } from '@/atoms/cloud-auth'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { getCrossedLowCreditThreshold } from '@/lib/low-credit-reminder'

const STORAGE_KEY_PREFIX = 'proma-low-credit-last-total:'

function readPreviousTotal(userId: string): number | null {
  try {
    const value = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`)
    if (value === null) return null
    const total = Number(value)
    return Number.isFinite(total) ? total : null
  } catch {
    return null
  }
}

function saveCurrentTotal(userId: string, total: number): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, String(total))
  } catch {
    // localStorage 不可用时仅在当前渲染生命周期内保持账单状态。
  }
}

export function LowCreditReminder(): null {
  const billing = useAtomValue(billingInfoAtom)
  const cloudUser = useAtomValue(cloudUserAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const previousTotalsRef = React.useRef(new Map<string, number>())

  React.useEffect(() => {
    if (!billing || !cloudUser) return

    const currentTotal = calcTotalAvailable(billing)
    const inMemoryTotal = previousTotalsRef.current.get(cloudUser.id)
    const previousTotal = inMemoryTotal ?? readPreviousTotal(cloudUser.id)
    const threshold = getCrossedLowCreditThreshold(previousTotal, currentTotal)
    previousTotalsRef.current.set(cloudUser.id, currentTotal)
    saveCurrentTotal(cloudUser.id, currentTotal)

    if (threshold === null) return

    const formattedTotal = currentTotal < 10 ? currentTotal.toFixed(2) : Math.floor(currentTotal)
    toast.warning(`额度已低于 ${threshold} 积分`, {
      description: `当前剩余 ${formattedTotal} 积分，建议及时充值以免任务中断。`,
      action: {
        label: '去充值',
        onClick: () => {
          setSettingsTab('billing')
          setSettingsOpen(true)
        },
      },
    })
  }, [billing, cloudUser, setSettingsOpen, setSettingsTab])

  return null
}
