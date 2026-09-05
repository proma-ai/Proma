/**
 * Slack 集成相关类型定义。
 *
 * Slack Bot Token 与 App Token 在主进程通过 Electron safeStorage 加密后保存；
 * renderer 仅通过受限 IPC 获取不含 Token 字段的设置 DTO 与连接状态；已保存的 Token 永不回传 renderer。
 */

export type SlackBridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** 单个本地 Slack Bot 配置（持久化到 ~/.proma/slack.json）。 */
export interface SlackBotConfig {
  id: string
  name: string
  enabled: boolean
  /** safeStorage 加密后的 xoxb token。 */
  botToken: string
  /** safeStorage 加密后的 xapp token。 */
  appToken: string
  defaultChannelId?: string
  defaultModelId?: string
  /** 显式配置后才接收后台/Automation 通知。 */
  homeChannelId?: string
}

export interface SlackConfig {
  version: 1
  bots: SlackBotConfig[]
}

/** Settings renderer 使用的脱敏配置，绝不包含 Bot 或 App Token。 */
export interface SlackBotSettingsConfig {
  id: string
  name: string
  enabled: boolean
  hasBotToken: boolean
  hasAppToken: boolean
  defaultChannelId?: string
  defaultModelId?: string
  homeChannelId?: string
}

export interface SlackSettingsConfig {
  version: 1
  bots: SlackBotSettingsConfig[]
}

/** 保存 Bot 时 token 为明文；空字符串表示保留已有密文。 */
export interface SlackBotConfigInput {
  id?: string
  name: string
  enabled: boolean
  botToken: string
  appToken: string
  defaultChannelId?: string
  defaultModelId?: string
  homeChannelId?: string
}

export interface SlackBridgeState {
  status: SlackBridgeStatus
  connectedAt?: number
  errorMessage?: string
  teamId?: string
  botUserId?: string
  activeBindings: number
  queuedRuns: number
}

export interface SlackBotBridgeState extends SlackBridgeState {
  botId: string
  botName: string
}

export interface SlackMultiBridgeState {
  bots: Record<string, SlackBotBridgeState>
}

/** 一个 Slack thread + 发言人映射到一个独立 Proma 会话。 */
export interface SlackThreadBinding {
  key: string
  botId: string
  teamId: string
  channelId: string
  rootThreadTs: string
  userId: string
  sessionId: string
  workspaceId: string
  channelIdForModel: string
  modelId?: string
  createdAt: number
  lastUsedAt: number
}

export interface SlackTestResult {
  success: boolean
  message: string
  teamName?: string
  botUserId?: string
}

export interface SlackAppManifestResult {
  manifest: Record<string, unknown>
  json: string
}

export const SLACK_IPC_CHANNELS = {
  GET_CONFIG: 'slack:get-config',
  SAVE_BOT_CONFIG: 'slack:save-bot-config',
  REMOVE_BOT: 'slack:remove-bot',
  GET_MANIFEST: 'slack:get-manifest',
  TEST_CONNECTION: 'slack:test-connection',
  START_BOT: 'slack:start-bot',
  STOP_BOT: 'slack:stop-bot',
  GET_STATUS: 'slack:get-status',
  STATUS_CHANGED: 'slack:status-changed',
} as const
