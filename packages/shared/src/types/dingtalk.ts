/**
 * 钉钉集成相关类型定义
 *
 * 包含钉钉 Bot 配置、Bridge 连接状态、IPC 通道常量。
 * 当前为第一阶段：凭证存储 + Stream 连接，消息处理后续迭代。
 */

// ===== 钉钉 Bot 配置 =====

/** 钉钉 Bot 应用配置（持久化到 ~/.proma/dingtalk.json）— 旧格式，向后兼容 */
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

/** 钉钉配置保存输入（Client Secret 为明文，主进程负责加密）— 旧格式，向后兼容 */
export interface DingTalkConfigInput {
  enabled: boolean
  clientId: string
  /** 明文 Client Secret */
  clientSecret: string
  defaultWorkspaceId?: string
}

// ===== 多 Bot 配置（v2） =====

/** 单个钉钉 Bot 配置 */
export interface DingTalkBotConfig {
  /** Bot 唯一标识（UUID） */
  id: string
  /** Bot 显示名称（如"研发助手"、"运维助手"） */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 钉钉应用 Client ID (AppKey) */
  clientId: string
  /** 钉钉应用 Client Secret (AppSecret)（safeStorage 加密后的 base64 字符串） */
  clientSecret: string
  /** 该 Bot 的默认工作区 ID */
  defaultWorkspaceId?: string
  /** 该 Bot 的默认渠道 ID */
  defaultChannelId?: string
  /** 该 Bot 的默认模型 ID */
  defaultModelId?: string
}

/** 多 Bot 配置文件（~/.proma/dingtalk.json 新格式） */
export interface DingTalkMultiBotConfig {
  version: 2
  bots: DingTalkBotConfig[]
}

/** 单个 Bot 配置保存输入（明文 secret） */
export interface DingTalkBotConfigInput {
  /** Bot ID（新建时不传，更新时必传） */
  id?: string
  /** Bot 显示名称 */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 钉钉应用 Client ID (AppKey) */
  clientId: string
  /** 明文 Client Secret（空字符串表示不修改） */
  clientSecret: string
  /** 默认工作区 ID */
  defaultWorkspaceId?: string
  /** 默认渠道 ID */
  defaultChannelId?: string
  /** 默认模型 ID */
  defaultModelId?: string
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

/** 单个 Bot 的 Bridge 状态（包含身份信息） */
export interface DingTalkBotBridgeState extends DingTalkBridgeState {
  /** Bot ID */
  botId: string
  /** Bot 显示名称 */
  botName: string
}

/** 多 Bot Bridge 状态聚合 */
export interface DingTalkMultiBridgeState {
  /** botId → 状态 */
  bots: Record<string, DingTalkBotBridgeState>
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

  // ===== 多 Bot（v2）=====

  /** 获取多 Bot 配置 */
  GET_MULTI_CONFIG: 'dingtalk:get-multi-config',
  /** 保存单个 Bot 配置（新建或更新） */
  SAVE_BOT_CONFIG: 'dingtalk:save-bot-config',
  /** 删除 Bot */
  REMOVE_BOT: 'dingtalk:remove-bot',
  /** 获取单个 Bot 的解密 Client Secret */
  GET_BOT_DECRYPTED_SECRET: 'dingtalk:get-bot-decrypted-secret',
  /** 启动单个 Bot Bridge */
  START_BOT: 'dingtalk:start-bot',
  /** 停止单个 Bot Bridge */
  STOP_BOT: 'dingtalk:stop-bot',
  /** 获取多 Bot Bridge 状态 */
  GET_MULTI_STATUS: 'dingtalk:get-multi-status',
  /** 多 Bot 状态变化推送 */
  MULTI_STATUS_CHANGED: 'dingtalk:multi-status-changed',
} as const
