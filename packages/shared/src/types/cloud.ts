/**
 * Cloud 模式相关类型和常量
 */

/** 应用运行模式 */
export type PromaMode = 'local' | 'cloud'

/** Cloud IPC 通道常量（用于主进程和渲染进程通信） */
export const CLOUD_IPC_CHANNELS = {
  // 认证相关
  LOGIN: 'cloud:auth:login',
  REGISTER: 'cloud:auth:register',
  LOGOUT: 'cloud:auth:logout',
  REFRESH_TOKEN: 'cloud:auth:refresh-token',
  GET_ME: 'cloud:auth:get-me',
  GET_AUTH_STATE: 'cloud:auth:get-state',
  // 后续阶段的通道预留
} as const
