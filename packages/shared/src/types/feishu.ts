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

/** 更新绑定请求（渲染进程 → 主进程） */
export interface FeishuUpdateBindingInput {
  /** 目标 chat_id */
  chatId: string
  /** 新的工作区 ID（不传则不修改） */
  workspaceId?: string
  /** 新的会话 ID（不传则不修改） */
  sessionId?: string
}

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
  /** 聊天类型（单聊或群聊） */
  chatType?: 'p2p' | 'group'
  /** 群名称（群聊时） */
  groupName?: string
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

// ===== 群聊相关类型 =====

/** 飞书消息事件中的 @mention 条目 */
export interface FeishuMention {
  /** 消息体中的占位符 key（如 "@_user_1"） */
  key: string
  /** 被 @ 用户/机器人的 ID，可能是字符串或 { open_id, union_id, user_id } 对象 */
  id: string | { open_id?: string; union_id?: string; user_id?: string }
  /** 被 @ 用户的显示名称 */
  name: string
  /** ID 类型（飞书 API 返回） */
  id_type?: string
}

/** 飞书群聊信息缓存 */
export interface FeishuGroupInfo {
  /** 群聊 chat_id */
  chatId: string
  /** 群名称 */
  name: string
  /** 群描述 */
  description?: string
  /** 群成员列表 */
  members?: FeishuGroupMember[]
  /** 缓存时间戳 */
  cachedAt: number
}

/** 飞书群成员信息 */
export interface FeishuGroupMember {
  /** 成员 open_id */
  openId: string
  /** 显示名称 */
  name: string
}

/** 飞书消息上下文（贯穿消息处理链） */
export interface FeishuMessageContext {
  /** 飞书 chat_id */
  chatId: string
  /** 发送者 open_id */
  senderOpenId: string
  /** 发送者显示名称（群聊时获取） */
  senderName?: string
  /** 消息 ID（用于群聊 thread reply） */
  messageId: string
  /** 聊天类型 */
  chatType: 'p2p' | 'group'
  /** 群名称（group 时） */
  groupName?: string
}

// ===== 群聊消息历史 =====

/** 飞书聊天消息（群聊上下文读取） */
export interface FeishuChatMessage {
  /** 消息 ID */
  messageId: string
  /** 发送者 ID */
  senderId: string
  /** 发送者类型 */
  senderType: 'user' | 'app' | 'anonymous' | 'unknown'
  /** 发送者显示名称（异步解析） */
  senderName?: string
  /** 消息类型（text / post / image / interactive 等） */
  msgType: string
  /** 消息内容（已解析的文本，非 text 类型为描述） */
  content: string
  /** 创建时间（毫秒时间戳） */
  createTime: number
}

// ===== IPC 通道常量 =====

export const FEISHU_IPC_CHANNELS = {
  /** 获取飞书配置 */
  GET_CONFIG: 'feishu:get-config',
  /** 保存飞书配置 */
  SAVE_CONFIG: 'feishu:save-config',
  /** 获取解密后的 App Secret */
  GET_DECRYPTED_SECRET: 'feishu:get-decrypted-secret',
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
  /** 更新绑定（修改工作区/会话） */
  UPDATE_BINDING: 'feishu:update-binding',
  /** 移除绑定 */
  REMOVE_BINDING: 'feishu:remove-binding',
  /** 渲染进程 → 主进程：上报用户在场状态 */
  REPORT_PRESENCE: 'feishu:report-presence',
  /** 渲染进程 → 主进程：设置某会话的通知模式 */
  SET_SESSION_NOTIFY: 'feishu:set-session-notify',
  /** 主进程 → 渲染进程：飞书通知已发送 */
  NOTIFICATION_SENT: 'feishu:notification-sent',
} as const
