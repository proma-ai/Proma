/**
 * PaymentMethodRadio - 支付方式选择
 *
 * 当前仅提供微信支付，Stripe 暂时隐藏
 */

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { PaymentMethod } from '@proma/shared'

interface PaymentMethodRadioProps {
  value: PaymentMethod
  onChange: (value: PaymentMethod) => void
}

export function PaymentMethodRadio({ value, onChange }: PaymentMethodRadioProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">选择支付方式</h3>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as PaymentMethod)}
        className="flex gap-6"
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="wechat" id="pay-wechat" />
          <Label htmlFor="pay-wechat" className="cursor-pointer text-sm">
            微信支付
          </Label>
        </div>
        {/* Stripe 国际支付暂时隐藏 */}
      </RadioGroup>
    </div>
  )
}
