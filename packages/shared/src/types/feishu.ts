/**
 * 飞书集成相关类型定义
 *
 * 包含飞书 Bot 配置、Bridge 连接状态、聊天绑定、
 * 通知模式、IPC 通道常量。
 */

// ===== 飞书 Bot 配置 =====

/** 飞书 Bot 应用配置（持久化到 ~/.proma/feishu.json） */
export interface FeishuConfig {
  /** 是否启用飞书集成 */
  enabled: boolean
  /** 飞书应用 App ID */
  appId: string
  /** 飞书应用 App Secret（safeStorage 加密后的 base64 字符串） */
  appSecret: string
  /** 默认绑定的工作区 ID */
  defaultWorkspaceId?: string
}

/** 飞书配置保存输入（App Secret 为明文，主进程负责加密） */
export interface FeishuConfigInput {
  enabled: boolean
  appId: string
  /** 明文 App Secret */
  appSecret: string
  defaultWorkspaceId?: string
}

// ===== Bridge 连接状态 =====

/** 飞书 Bridge 连接状态 */
export type FeishuBridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** 飞书 Bridge 状态详情 */
export interface FeishuBridgeState {
  status: FeishuBridgeStatus
  /** 上次连接成功时间 */
  connectedAt?: number
  /** 错误信息 */
  errorMessage?: string
  /** 当前活跃的聊天绑定数量 */
  activeBindings: number
}

// ===== 聊天绑定 =====

/** 飞书聊天 → Proma 会话绑定（内存态，不持久化） */
export interface FeishuChatBinding {
  /** 飞书 chat_id（单聊或群聊） */
  chatId: string
  /** 飞书用户 open_id */
  userId: string
  /** 绑定的 Proma 会话 ID */
  sessionId: string
  /** 绑定的工作区 ID */
  workspaceId: string
  /** 渠道 ID */
  channelId: string
  /** 模型 ID */
  modelId?: string
  /** 会话模式 */
  mode: 'agent' | 'chat'
  /** 创建时间 */
  createdAt: number
}

// ===== 通知模式 =====

/** 飞书通知模式（per-session） */
export type FeishuNotifyMode = 'auto' | 'always' | 'off'

// ===== 连接测试 =====

/** 飞书连接测试结果 */
export interface FeishuTestResult {
  success: boolean
  message: string
  /** Bot 名称（测试成功时返回） */
  botName?: string
}

// ===== 在场状态上报 =====

/** 渲染进程上报的用户在场状态 */
export interface FeishuPresenceReport {
  /** 当前正在查看的会话 ID */
  activeSessionId: string | null
  /** 最后交互时间戳 */
  lastInteractionAt: number
}

/** 飞书通知已发送的事件载荷 */
export interface FeishuNotificationSentPayload {
  sessionId: string
  sessionTitle: string
  preview: string
}

// ===== IPC 通道常量 =====

export const FEISHU_IPC_CHANNELS = {
  /** 获取飞书配置 */
  GET_CONFIG: 'feishu:get-config',
  /** 保存飞书配置 */
  SAVE_CONFIG: 'feishu:save-config',
  /** 测试飞书连接 */
  TEST_CONNECTION: 'feishu:test-connection',
  /** 启动 Bridge */
  START_BRIDGE: 'feishu:start-bridge',
  /** 停止 Bridge */
  STOP_BRIDGE: 'feishu:stop-bridge',
  /** 获取 Bridge 状态 */
  GET_STATUS: 'feishu:get-status',
  /** Bridge 状态变化（主进程 → 渲染进程推送） */
  STATUS_CHANGED: 'feishu:status-changed',
  /** 获取活跃绑定列表 */
  LIST_BINDINGS: 'feishu:list-bindings',
  /** 渲染进程 → 主进程：上报用户在场状态 */
  REPORT_PRESENCE: 'feishu:report-presence',
  /** 渲染进程 → 主进程：设置某会话的通知模式 */
  SET_SESSION_NOTIFY: 'feishu:set-session-notify',
  /** 主进程 → 渲染进程：飞书通知已发送 */
  NOTIFICATION_SENT: 'feishu:notification-sent',
} as const
