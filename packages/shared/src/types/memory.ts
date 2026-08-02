/**
 * Memory（长期记忆）相关类型
 *
 * Proma Proactive Memory：主动记忆（Capture）+ 主动回忆（Recall）能力。
 *
 * 分层模型（参考 TencentDB-Agent-Memory，适配 Proma 本地优先架构）：
 * - L0 Raw：会话 JSONL（复用 session-core，不在此建模）
 * - L1 Atom：结构化记忆条目（LLM 提取 + 去重）
 * - L2 Scene：场景块 markdown（主题聚合）
 * - L3 Persona：用户画像 markdown（稳定注入）
 * - Correction：行为纠正候选（需用户确认后生效）
 * - SOP Candidate：流程模板候选（二期）
 */

/** 记忆条目类型 */
export type MemoryAtomType =
  | 'fact'        // 客观事实：用户身份、项目信息、技术选型
  | 'preference'  // 用户偏好：喜欢的语言、工具、风格
  | 'correction'  // 行为纠正：用户指出 Agent 的错误/改进
  | 'sop'         // 可复用流程：重复出现的操作步骤
  | 'todo_context' // 任务上下文：正在进行/计划的任务背景

/** L1 原子记忆条目（一行 JSONL） */
export interface MemoryAtom {
  /** 稳定 ID：类型前缀 + 时间戳 + 随机串 */
  id: string
  /** 记忆内容（简洁、自包含、可独立理解） */
  content: string
  /** 记忆类型 */
  type: MemoryAtomType
  /** 重要度 0-100（LLM 判断；提取时默认 50） */
  priority: number
  /** 来源会话 ID（可回溯） */
  sessionId?: string
  /** 来源工作区 slug */
  workspaceSlug?: string
  /** 记录时间（epoch ms） */
  createdAt: number
  /** 最近更新时间（epoch ms） */
  updatedAt: number
  /** 去重用的归一化内容指纹（相似内容更新而非新增） */
  fingerprint?: string
  /** 是否已确认（correction 类默认 false，需审批） */
  confirmed: boolean
  /** 元数据（来源消息摘要等） */
  metadata?: Record<string, unknown>
}

/** L2 场景块元数据（场景内容以 markdown 文件保存） */
export interface SceneBlock {
  id: string
  title: string
  /** 关联的 atom id 列表 */
  atomIds: string[]
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** L3 用户画像（persona.md 的解析摘要，用于注入） */
export interface PersonaProfile {
  /** 用户姓名/称呼 */
  name?: string
  /** 一句话定位 */
  summary?: string
  /** 长期偏好列表 */
  preferences: string[]
  /** 交互协议（用户希望 Agent 如何工作） */
  interactionRules: string[]
  /** 演进轨迹（重要阶段） */
  evolution: string[]
  /** 最近更新时间 */
  updatedAt: number
}

/** 行为纠正候选（需审批） */
export interface MemoryCorrection {
  id: string
  /** 用户原始纠正语句 */
  raw: string
  /** 提炼后的行为规则 */
  rule: string
  /** 来源会话 ID */
  sessionId?: string
  /** 创建时间 */
  createdAt: number
  /** 状态：pending=待确认，active=生效，rejected=拒绝，superseded=被替代 */
  status: 'pending' | 'active' | 'rejected' | 'superseded'
}

/** 记忆统计（UI 与工具展示） */
export interface MemoryStats {
  /** L1 原子记忆总数 */
  atomCount: number
  /** 各类型数量 */
  byType: Record<MemoryAtomType, number>
  /** L2 场景数 */
  sceneCount: number
  /** 待审批纠正数 */
  pendingCorrections: number
  /** persona 是否存在 */
  personaExists: boolean
  /** 记忆根目录 */
  rootDir: string
  /** 最近一次提取时间（epoch ms，无则 0） */
  lastExtractionAt: number
}

/** 记忆检索请求 */
export interface MemorySearchRequest {
  query: string
  /** 返回条数上限（默认 5，最多 20） */
  limit?: number
  /** 按类型过滤 */
  type?: MemoryAtomType
  /** 是否包含未确认条目（默认 false） */
  includeUnconfirmed?: boolean
}

/** 记忆检索命中 */
export interface MemorySearchHit {
  atom: MemoryAtom
  /** 相似度分数 0-1 */
  score: number
  /** 命中的关键词 */
  matchedTerms: string[]
}

/** 记忆检索结果 */
export interface MemorySearchResult {
  query: string
  hits: MemorySearchHit[]
  /** 检索方式：keyword / latest / fallback（关键词 0 命中且查询含回忆意图时的降级召回） */
  strategy: 'keyword' | 'latest' | 'fallback'
  /** 耗时 ms */
  durationMs: number
}

/** 主动记忆捕获请求（LLM 提取后的结构化结果） */
export interface MemoryCaptureInput {
  /** 待提取的对话消息（user/assistant 文本） */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 来源会话 ID */
  sessionId?: string
  /** 来源工作区 slug */
  workspaceSlug?: string
  /** 是否允许写入未确认的 correction（默认 true，生成 pending 纠正） */
  withCorrections?: boolean
}

/** 提取器对单条消息的可选记忆候选（供 Agent 工具直接沉淀） */
export interface MemoryCandidate {
  content: string
  type: MemoryAtomType
  priority?: number
}
