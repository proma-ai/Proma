import { BROWSER_RISK_DISCLAIMER_VERSION } from '../../types/settings'

export interface BrowserRiskDisclaimerSettings {
  browserRiskDisclaimerVersion?: number
}

/** 版本化确认：未来若风险文案实质更新，可提升版本后再次展示。 */
export function hasAcknowledgedBrowserRiskDisclaimer(settings: BrowserRiskDisclaimerSettings): boolean {
  return (settings.browserRiskDisclaimerVersion ?? 0) >= BROWSER_RISK_DISCLAIMER_VERSION
}
