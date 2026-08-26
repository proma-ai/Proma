import * as React from 'react'
import { cn } from '@/lib/utils'

const USER_AGREEMENT_URL = 'https://proma.cool/user-agreement'
const PRIVACY_POLICY_URL = 'https://proma.cool/privacy-policy'

interface LegalAgreementProps {
  accepted: boolean
  onAcceptedChange: (accepted: boolean) => void
  disabled?: boolean
}

/** 认证前必须确认的用户协议与隐私政策。 */
export function LegalAgreement({
  accepted,
  onAcceptedChange,
  disabled = false,
}: LegalAgreementProps): React.ReactElement {
  const openLegalPage = (event: React.MouseEvent<HTMLButtonElement>, url: string): void => {
    event.preventDefault()
    window.electronAPI.openExternal(url)
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-3 text-sm transition-colors',
        accepted
          ? 'border-primary/30 bg-primary/5'
          : 'border-border bg-muted/40',
        disabled ? 'opacity-60' : 'hover:border-primary/40',
      )}
    >
      <p className="mb-2 text-xs font-medium text-foreground">
        继续前，请先确认以下协议
      </p>
      <div className="flex items-start gap-3 text-muted-foreground">
        <label
          htmlFor="legal-agreement"
          className={cn(
            'flex min-h-5 cursor-pointer items-start gap-2 leading-5',
            disabled && 'cursor-not-allowed',
          )}
        >
          <input
            id="legal-agreement"
            type="checkbox"
            checked={accepted}
            onChange={(event) => onAcceptedChange(event.target.checked)}
            disabled={disabled}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span>我已阅读并同意</span>
        </label>
        <div className="leading-5">
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={(event) => openLegalPage(event, USER_AGREEMENT_URL)}
          >
            《用户协议》
          </button>
          和
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={(event) => openLegalPage(event, PRIVACY_POLICY_URL)}
          >
            《隐私政策》
          </button>
        </div>
      </div>
    </div>
  )
}
