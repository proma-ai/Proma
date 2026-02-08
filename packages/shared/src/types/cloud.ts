/**
 * Cloud 模式相关类型和常量
 */

/** 应用运行模式 */
export type PromaMode = 'local' | 'cloud'

/** Cloud 用户基础信息（跨 IPC 传输的轻量用户数据） */
export interface CloudUserInfo {
  id: string
  email: string
  name: string
  image?: string | null
  avatar?: string | null
}

/** Cloud 认证状态快照 */
export interface CloudAuthState {
  isAuthenticated: boolean
  user: CloudUserInfo | null
}

/** Cloud 认证 IPC 响应 */
export interface CloudAuthIpcResponse {
  success: boolean
  user?: CloudUserInfo
  error?: string
}

/** Cloud IPC 通道常量（用于主进程和渲染进程通信） */
export const CLOUD_IPC_CHANNELS = {
  // 认证相关
  LOGIN: 'cloud:auth:login',
  REGISTER: 'cloud:auth:register',
  LOGOUT: 'cloud:auth:logout',
  REFRESH_TOKEN: 'cloud:auth:refresh-token',
  GET_ME: 'cloud:auth:get-me',
  GET_AUTH_STATE: 'cloud:auth:get-state',
  // 认证状态变化推送通道（主进程 → 渲染进程）
  AUTH_STATE_CHANGED: 'cloud:auth:state-changed',
  // 后续阶段的通道预留
} as const
