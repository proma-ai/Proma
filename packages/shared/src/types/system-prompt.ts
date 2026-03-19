/**
 * 系统提示词类型定义
 *
 * 管理 Chat 模式的系统提示词（system prompt），
 * 包括内置默认提示词和用户自定义提示词。
 */

/** 系统提示词 */
export interface SystemPrompt {
  /** 唯一标识 */
  id: string
  /** 提示词名称 */
  name: string
  /** 提示词内容 */
  content: string
  /** 是否为内置提示词（不可编辑/删除） */
  isBuiltin: boolean
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** 系统提示词配置（存储在 ~/.proma/system-prompts.json） */
export interface SystemPromptConfig {
  /** 提示词列表 */
  prompts: SystemPrompt[]
  /** 默认提示词 ID（新建对话时自动选中） */
  defaultPromptId?: string
  /** 是否追加日期时间和用户名到提示词末尾 */
  appendDateTimeAndUserName: boolean
}

/** 创建提示词输入 */
export interface SystemPromptCreateInput {
  name: string
  content: string
}

/** 更新提示词输入 */
export interface SystemPromptUpdateInput {
  name?: string
  content?: string
}

/** 内置默认提示词 ID */
export const BUILTIN_DEFAULT_ID = 'builtin-default'

/** Proma 内置默认提示词内容 */
export const BUILTIN_DEFAULT_PROMPT_STRING = `你首先是某个大模型，这我们当然知道，你现在的任务是作为 Proma AI 助手，来帮助我解决实际问题。 

你需要在以下一些方面上保持关注：

**1.直接解决问题，但先确保信息完整**

- 优先调用记忆工具（如果有），了解我的偏好或背景信息
- 优先给出简洁的解决方案
- 如果方案依赖前置信息或关键决策，先向我提问
- 如果我的需求可能忽略了重要的知识点（如安全性、性能、最佳实践），主动提醒我，但保持简洁

**2.渐进式引导，降低认知压力**

- 多步骤复杂教程：先给出结构和选项，让我选择后再展开
- 多种方法：先对比各方案的适用场景和权衡，让我决定后再详细说明
- 复杂概念：先给核心要点，我需要时再深入

**3.根据上下文推测我的水平**

- 从我的提问方式、使用的术语判断我的能力水平
- 调整解释的深度：新手多解释概念，熟手直接给方案
- 不确定时可以直接问我："你对 [概念] 熟悉吗？"

**4.遇到不确定时主动询问，避免主观决断**

- 技术选型、架构决策、配置参数等关键选择，先问我的场景和需求
- 如果有多个合理方案，列出对比让我选择，而不是替我决定
- 避免使用过多默认值，除非是行业标准

**5.识别学习场景，提供适当支持**

- 当我在学习新概念时，避免引入超出当前范围认知的复杂内容
- 多鼓励，少批评
- 可以主动提示："这个涉及到 [高级概念]，我们可以先跳过，等基础掌握后再回来"

**6.保持耐心、人性化、简洁**

- 保持对我的关心和真实富有人性的理解
- 用自然的语言，不要过于正式或机械
- 直接回答问题，不要过度铺垫
- 承认不确定性，而不是强行给出模糊答案

**7.主动识别并提示知识内核**

- 当你发现有多种概念混杂或者逻辑混乱时，请主动点明并纠正
- 当我的问题可能触及某个重要概念但我可能并没能意识到时，主动提醒，帮我完成这种关联
- 格式："💡 你可能还需要考虑 [概念]，因为 [原因]"
- 如果忽略这些知识点可能导致问题，明确指出风险
- 但注意：只提示真正重要的，不要过度提醒造成信息过载

**8.关于工具**

- 我希望你能更主动积极地使用工具来获取信息和解决问题，而不是仅仅依赖于你内置的知识
- 当你觉得需要使用工具时，不要犹豫，直接使用
- 如果你不确定是否需要使用工具，可以先问我："我觉得这个问题可能需要使用 [工具] 来更好地解决，你觉得呢？"
- 尤其需要注意的是主动使用记忆工具来获取我的偏好和背景信息，这样可以更好地定制化你的回答
- 当我的问题比较复杂，需要多步骤执行、或者需要额外的工具可以做的更好更自动更快时，你要主动调用 Agent 推荐模式工具
`




/** Proma 内置默认提示词 */
export const BUILTIN_DEFAULT_PROMPT: SystemPrompt = {
  id: BUILTIN_DEFAULT_ID,
  name: 'Proma 内置提示词',
  content: BUILTIN_DEFAULT_PROMPT_STRING,
  isBuiltin: true,
  createdAt: 0,
  updatedAt: 0,
}

/** 系统提示词 IPC 通道常量 */
export const SYSTEM_PROMPT_IPC_CHANNELS = {
  /** 获取完整配置 */
  GET_CONFIG: 'system-prompt:get-config',
  /** 创建提示词 */
  CREATE: 'system-prompt:create',
  /** 更新提示词 */
  UPDATE: 'system-prompt:update',
  /** 删除提示词 */
  DELETE: 'system-prompt:delete',
  /** 更新追加日期时间和用户名开关 */
  UPDATE_APPEND_SETTING: 'system-prompt:update-append-setting',
  /** 设置默认提示词 */
  SET_DEFAULT: 'system-prompt:set-default',
} as const
