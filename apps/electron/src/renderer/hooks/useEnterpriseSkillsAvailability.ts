import { useAtomValue } from 'jotai'
import { billingInfoAtom, billingLoadingAtom } from '@/atoms/cloud-billing'
import { cloudUserAtom } from '@/atoms/cloud-auth'

/**
 * 企业 Skills 入口资格直接取自当前用户的账单/权益快照。
 *
 * `/user/billing` 会在登录、窗口重新聚焦与官方渠道扣费后刷新；企业目录仅在
 * 用户实际打开企业 Skills 时才由 EnterpriseSkillsTab 请求。服务端仍为所有
 * 企业 Skills 操作执行独立鉴权，客户端状态只用于控制入口展示。
 */
export function useEnterpriseSkillsAvailability(): {
  loading: boolean
  enabled: boolean
  canPublish: boolean
} {
  const cloudUser = useAtomValue(cloudUserAtom)
  const billing = useAtomValue(billingInfoAtom)
  const billingLoading = useAtomValue(billingLoadingAtom)
  // 新旧账单响应交替期间，enterprise 可能存在但尚未带 capabilities；默认禁用入口而非中断 SidePanel 渲染。
  const skills = billing?.enterprise?.capabilities?.skills

  return {
    loading: cloudUser !== null && (billingLoading || billing === null),
    enabled: skills?.enabled === true,
    canPublish: skills?.enabled === true && skills.canPublish === true,
  }
}
