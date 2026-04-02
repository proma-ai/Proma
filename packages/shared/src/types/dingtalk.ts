/**
 * 钉钉集成相关类型定义
 *
 * 包含钉钉 Bot 配置、Bridge 连接状态、IPC 通道常量。
 * 当前为第一阶段：凭证存储 + Stream 连接，消息处理后续迭代。
 */

// ===== 钉钉 Bot 配置 =====

/** 钉钉 Bot 应用配置（持久化到 ~/.proma/dingtalk.json） */
export interface DingTalkConfig {
  /** 是否启用钉钉集成 */
  enabled: boolean
  /** 钉钉应用 Client ID (AppKey) */
  clientId: string
  /** 钉钉应用 Client Secret (AppSecret)（safeStorage 加密后的 base64 字符串） */
  clientSecret: string
  /** 默认绑定的工作区 ID */
  defaultWorkspaceId?: string
}

/** 钉钉配置保存输入（Client Secret 为明文，主进程负责加密） */
export interface DingTalkConfigInput {
  enabled: boolean
  clientId: string
  /** 明文 Client Secret */
  clientSecret: string
  defaultWorkspaceId?: string
}

// ===== Bridge 连接状态 =====

/** 钉钉 Bridge 连接状态 */
export type DingTalkBridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** 钉钉 Bridge 状态详情 */
export interface DingTalkBridgeState {
  status: DingTalkBridgeStatus
  /** 上次连接成功时间 */
  connectedAt?: number
  /** 错误信息 */
  errorMessage?: string
}

// ===== 连接测试 =====

/** 钉钉连接测试结果 */
export interface DingTalkTestResult {
  success: boolean
  message: string
}

// ===== IPC 通道常量 =====

export const DINGTALK_IPC_CHANNELS = {
  /** 获取钉钉配置 */
  GET_CONFIG: 'dingtalk:get-config',
  /** 保存钉钉配置 */
  SAVE_CONFIG: 'dingtalk:save-config',
  /** 获取解密后的 Client Secret */
  GET_DECRYPTED_SECRET: 'dingtalk:get-decrypted-secret',
  /** 测试钉钉连接 */
  TEST_CONNECTION: 'dingtalk:test-connection',
  /** 启动 Bridge */
  START_BRIDGE: 'dingtalk:start-bridge',
  /** 停止 Bridge */
  STOP_BRIDGE: 'dingtalk:stop-bridge',
  /** 获取 Bridge 状态 */
  GET_STATUS: 'dingtalk:get-status',
  /** Bridge 状态变化（主进程 → 渲染进程推送） */
  STATUS_CHANGED: 'dingtalk:status-changed',
} as const
