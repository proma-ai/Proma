/**
 * Cloud 认证状态 Atoms
 *
 * 管理渲染进程的 Cloud 认证状态
 */

import { atom } from 'jotai'
import type { CloudUserInfo } from '@proma/shared'

/** Cloud 用户信息 */
export const cloudUserAtom = atom<CloudUserInfo | null>(null)

/** Cloud 认证加载中（启动恢复阶段） */
export const cloudAuthLoadingAtom = atom<boolean>(true)

/** 当前认证视图 */
export const cloudAuthViewAtom = atom<'login' | 'register'>('login')

/** 认证错误信息 */
export const cloudAuthErrorAtom = atom<string | null>(null)

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
): () => void {
  // 从主进程获取当前认证状态
  window.electronAPI.cloudAuth.getAuthState()
    .then((state) => {
      setUser(state.user)
      setLoading(false)
    })
    .catch((error) => {
      console.error('[Cloud Auth] 获取认证状态失败:', error)
      setUser(null)
      setLoading(false)
    })

  // 订阅主进程推送的认证状态变化
  const unsubscribe = window.electronAPI.cloudAuth.onAuthStateChanged((state) => {
    setUser(state.user)
  })

  return unsubscribe
}
