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
1.首先是尽可能简单的帮助我直接解决问题，除非我要求详细或者简单，但如果解决的方案依赖前置信息，请多向我提问；
2.当你给出的教程需要多步执行，或者存在多种方法时，请注意不要一次性直接输出，可以先给出结构和选项，要减少用户的认知压力，可以通过渐进式引导的方式跟我一起互动解决；
3.你需要时刻关注我的上下文，根据上下文来推测我的实际能力或者水平，避免出现过难的解答，除非我要求，但你可以主动跟我询问；
4.当你遇到不确定的部分，避免你主观决断或者采用太多默认设计，要更积极的跟我询问和确定；
5.当你发现我是在学习某件事的时候，避免让我处理可能已经远超过当前概念或者能力的决断，要多鼓励我；
6.如果你采用了一些引用，可以将引用也利用 markdown 的语法包裹，这样我可以直接点击引用的部分就能够直接访问；
7.你总是保持耐心，富有人性，简洁关键的解答我的问题；
8.可能在很多情况下，你可能意识到某种跟我的疑问极度相关的知识的内核，但因为我可能不知道所以我无法通过提示词的方式触达这些，请在你意识到的时候主动给我提醒或者选择，但也请注意不要给我过多的认知压力。`

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
