/**
 * 微信集成相关类型定义
 *
 * 基于微信 iLink Bot API（官方协议）。
 * 包含 iLink 客户端类型、Bridge 状态、IPC 通道常量。
 */

// ===== iLink 凭证 =====

/** 微信 iLink 登录凭证（扫码登录后获得） */
export interface WeChatCredentials {
  /** Bot 认证令牌 */
  botToken: string
  /** Bot 的 iLink ID */
  ilinkBotId: string
  /** API 基础 URL（登录时返回，可能为空则用默认值） */
  baseUrl: string
  /** 用户的 iLink ID */
  ilinkUserId: string
}

// ===== 配置 =====

/** 微信配置（持久化到 ~/.proma/wechat.json） */
export interface WeChatConfig {
  /** 是否启用微信集成 */
  enabled: boolean
  /** iLink 凭证（botToken 使用 safeStorage 加密） */
  credentials: WeChatCredentials | null
  /** 默认绑定的工作区 ID */
  defaultWorkspaceId?: string
}

// ===== Bridge 连接状态 =====

/** 微信 Bridge 连接状态 */
export type WeChatBridgeStatus =
  | 'disconnected'
  | 'waiting_scan'    // 等待用户扫码
  | 'scanned'         // 已扫码，等待确认
  | 'connecting'      // 正在建立长轮询
  | 'connected'       // 长轮询运行中
  | 'error'

/** 微信 Bridge 状态详情 */
export interface WeChatBridgeState {
  status: WeChatBridgeStatus
  /** 上次连接成功时间 */
  connectedAt?: number
  /** 错误信息 */
  errorMessage?: string
  /** QR 码图片内容（base64，waiting_scan 时有值） */
  qrCodeData?: string
}

// ===== iLink API 类型 =====

/** iLink 消息项类型 */
export const WECHAT_ITEM_TYPE = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

/** iLink 消息类型 */
export const WECHAT_MESSAGE_TYPE = {
  USER: 1,
  BOT: 2,
} as const

/** iLink 消息状态 */
export const WECHAT_MESSAGE_STATE = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const

/** iLink 消息项 */
export interface WeChatMessageItem {
  type: number
  text_item?: { text: string }
  image_item?: { url?: string; aeskey?: string; media?: WeChatMediaInfo }
  voice_item?: { media?: WeChatMediaInfo; text?: string; playtime?: number }
  file_item?: { media?: WeChatMediaInfo; file_name?: string; len?: string }
  video_item?: { media?: WeChatMediaInfo; video_size?: number }
}

/** iLink 媒体信息（CDN 加密引用） */
export interface WeChatMediaInfo {
  encrypt_query_param: string
  aes_key: string
  encrypt_type: number
  full_url?: string
}

/** iLink 收到的微信消息 */
export interface WeChatIncomingMessage {
  seq?: number
  message_id?: number
  from_user_id: string
  to_user_id: string
  message_type: number
  message_state: number
  item_list: WeChatMessageItem[]
  context_token: string
}

// ===== IPC 通道常量 =====

export const WECHAT_IPC_CHANNELS = {
  /** 获取微信配置 */
  GET_CONFIG: 'wechat:get-config',
  /** 保存微信配置 */
  SAVE_CONFIG: 'wechat:save-config',
  /** 开始扫码登录 */
  START_LOGIN: 'wechat:start-login',
  /** 登出 */
  LOGOUT: 'wechat:logout',
  /** 启动 Bridge（用已有凭证） */
  START_BRIDGE: 'wechat:start-bridge',
  /** 停止 Bridge */
  STOP_BRIDGE: 'wechat:stop-bridge',
  /** 获取 Bridge 状态 */
  GET_STATUS: 'wechat:get-status',
  /** Bridge 状态变化（主进程 → 渲染进程推送） */
  STATUS_CHANGED: 'wechat:status-changed',
} as const
