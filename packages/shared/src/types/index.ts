/**
 * Shared type definitions for proma
 */

// Placeholder types - will be expanded as needed
export interface Workspace {
  id: string
  name: string
  path: string
}

// 运行时相关类型
export * from './runtime'

// 渠道（AI 供应商）相关类型
export * from './channel'

// 代理配置相关类型
export * from './proxy'

// Chat 相关类型
export * from './chat'

// Agent 相关类型
export * from './agent'
export * from './browser'
export * from './reasoning-profile'

// Agent Provider 适配器接口
export * from './agent-provider'

// 环境检测相关类型
export * from './environment'

// 第三方安装包（Git、Node.js 等）相关类型
export * from './installer'

// GitHub Release 相关类型
export * from './github'

// 系统提示词相关类型
export * from './system-prompt'

// Chat 工具（function calling）相关类型
export * from './chat-tool'

// 飞书集成相关类型
export * from './feishu'

// 钉钉集成相关类型
export * from './dingtalk'

// 微信集成相关类型
export * from './wechat'

// 定时任务（Automation）相关类型
export * from './automation'
// 本地任务与日程（Planning）相关类型
export * from './planning'

// Agent 灵动岛相关类型
export * from './agent-island'
