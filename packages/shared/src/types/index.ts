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

// Chat 相关类型
export * from './chat'

// Agent 相关类型
export * from './agent'

// Cloud 模式相关类型
export * from './cloud'

// 数据同步相关类型
export * from './sync'
