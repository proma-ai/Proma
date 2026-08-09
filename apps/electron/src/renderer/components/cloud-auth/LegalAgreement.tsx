import * as React from 'react'

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
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <input
        id="legal-agreement"
        type="checkbox"
        checked={accepted}
        onChange={(event) => onAcceptedChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <div>
        <label htmlFor="legal-agreement">我已阅读并同意</label>
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={(event) => openLegalPage(event, USER_AGREEMENT_URL)}
        >
          《用户协议》
        </button>
        和
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={(event) => openLegalPage(event, PRIVACY_POLICY_URL)}
        >
          《隐私政策》
        </button>
      </div>
    </div>
  )
}
