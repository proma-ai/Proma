export interface OnboardingAccountReadiness {
  isAuthLoading: boolean
  hasAuthenticatedUser: boolean
  isAgentSettingsReady: boolean
}

/**
 * 首次安装的账户页必须等待认证和 Agent 设置均稳定后，才能离开 Onboarding。
 * 否则会在官方渠道、默认模型和工作区尚未就绪时创建欢迎会话。
 */
export function canCompleteOnboardingAccount({
  isAuthLoading,
  hasAuthenticatedUser,
  isAgentSettingsReady,
}: OnboardingAccountReadiness): boolean {
  return !isAuthLoading && hasAuthenticatedUser && isAgentSettingsReady
}
