/**
 * Cloud 认证状态 Atoms
 *
 * 管理渲染进程的 Cloud 认证状态
 */

import { atom } from 'jotai'
import type { CloudUserInfo } from '@proma/shared'

/** 认证视图类型 */
export type CloudAuthView =
  | 'login'
  | 'register'
  | 'verify-email'
  | 'forgot-password'
  | 'reset-password'
  | 'pending'

/** Cloud 用户信息 */
export const cloudUserAtom = atom<CloudUserInfo | null>(null)

/** Cloud 认证加载中（启动恢复阶段） */
export const cloudAuthLoadingAtom = atom<boolean>(true)

/** 有 token、但主进程尚未从 Cloud 恢复用户身份。 */
export const cloudAuthRecoveryPendingAtom = atom<boolean>(false)

/** 当前认证视图 */
export const cloudAuthViewAtom = atom<CloudAuthView>('login')

/** 认证错误信息 */
export const cloudAuthErrorAtom = atom<string | null>(null)

/** 认证流程中的邮箱（用于验证/重置密码页面间传递） */
export const cloudAuthEmailAtom = atom<string>('')

/** 是否已认证（派生 atom） */
export const isCloudAuthenticatedAtom = atom<boolean>(
  (get) => get(cloudUserAtom) !== null,
)

/**
 * 初始化 Cloud 认证状态
 *
 * 调用 IPC 获取认证状态 + 订阅状态变化
 * 返回清理函数
 */
export function initializeCloudAuth(
  setUser: (user: CloudUserInfo | null) => void,
  setLoading: (loading: boolean) => void,
  setRecoveryPending: (pending: boolean) => void,
): () => void {
  let disposed = false
  let receivedChange = false

  // 先订阅再读取快照：登录广播若先到，不能被慢到的旧未登录快照覆盖。
  const unsubscribe = window.electronAPI.cloudAuth.onAuthStateChanged((state) => {
    receivedChange = true
    if (disposed) return
    setUser(state.user)
    setRecoveryPending(state.recoveryPending)
    setLoading(false)
  })

  // 从主进程获取当前认证状态
  window.electronAPI.cloudAuth.getAuthState()
    .then((state) => {
      if (disposed || receivedChange) return
      setUser(state.user)
      setRecoveryPending(state.recoveryPending)
      setLoading(false)
    })
    .catch((error) => {
      if (disposed || receivedChange) return
      console.error('[Cloud Auth] 获取认证状态失败:', error)
      setUser(null)
      setRecoveryPending(false)
      setLoading(false)
    })

  return () => {
    disposed = true
    unsubscribe()
  }
}
