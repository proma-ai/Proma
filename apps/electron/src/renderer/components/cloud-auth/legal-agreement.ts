/** 未勾选协议时，Google OAuth 按钮展示的下一步提示。 */
export const GOOGLE_OAUTH_LEGAL_ACCEPTANCE_HINT =
  '请先勾选上方协议，表示已阅读并同意《用户协议》和《隐私政策》，再继续使用 Google。'

/** 是否已满足认证请求的协议同意条件。 */
export function canSubmitWithLegalAcceptance(accepted: boolean): boolean {
  return accepted
}
