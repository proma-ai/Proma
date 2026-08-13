import * as React from 'react'
import { BillingSettings } from './BillingSettings'
import { WhyPromaOfficial } from './WhyPromaOfficial'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface OnboardingBillingPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 跳过进阶篇后，引导用户进入购买额度页的轻量弹窗。 */
export function OnboardingBillingPromptDialog({
  open,
  onOpenChange,
}: OnboardingBillingPromptDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-3rem)] max-w-6xl overflow-y-auto p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle>购买 Proma 商业版额度</DialogTitle>
        </DialogHeader>
        {/* 新用户首屏：先说明为什么选择 Proma 官方的 AI 渠道，再选额度方案 */}
        <WhyPromaOfficial />
        <BillingSettings onboarding />
      </DialogContent>
    </Dialog>
  )
}
