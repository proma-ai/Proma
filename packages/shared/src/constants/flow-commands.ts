/**
 * Flow 命令常量与解析
 *
 * Flow 是独立于 Skill 的动态编排模块，用 `!` mention 触发（如 `!deep-research`）。
 * SDK 自动生成 JavaScript 编排脚本，多 Agent 并行执行，实时展示进度。
 *
 * 内置 Flow：透传给 SDK 原生识别（如 /deep-research，SDK 内置命令）
 * 自定义 Flow：注入 scriptPath 指向 flow.js，SDK 通过 Workflow 工具加载执行
 */

// ===== 内置 Flow 定义 =====

/** 内置 Flow 命令定义 */
export interface BuiltinFlowCommand {
  /** Flow slug（目录名，如 deep-research） */
  slug: string
  /** 触发名（含 ! 前缀，如 !deep-research） */
  command: string
  /** 显示描述 */
  description: string
  /** SDK 内置斜杠命令（如 /deep-research），透传给 SDK 识别 */
  sdkCommand: string
  /** 对应的 SubAgent 名称，模型通过 Agent 工具调用 */
  agentName: string
}

/** 内置 Flow 命令列表 */
export const BUILTIN_FLOW_COMMANDS = [
  {
    slug: 'deep-research',
    command: '!deep-research',
    description: 'Deep research harness — 扇出搜索、交叉验证、引用报告',
    sdkCommand: '/deep-research',
    agentName: 'deep-researcher',
  },
  {
    slug: 'ultracode',
    command: '!ultracode',
    description: 'Dynamic workflow — 动态工作流编写和运行',
    sdkCommand: '/ultracode',
    agentName: 'workflow-runner',
  },
] as const satisfies readonly BuiltinFlowCommand[]

/** slug → 内置 Flow 命令映射 */
const BUILTIN_FLOW_COMMAND_MAP: ReadonlyMap<string, BuiltinFlowCommand> = new Map(
  BUILTIN_FLOW_COMMANDS.map((c) => [c.slug, c]),
)

/** 根据 slug 获取内置 Flow 命令 */
export function getBuiltinFlowCommandBySlug(slug: string): BuiltinFlowCommand | undefined {
  return BUILTIN_FLOW_COMMAND_MAP.get(slug)
}

/** 判断 slug 是否为内置 Flow */
export function isBuiltinFlowSlug(slug: string): boolean {
  return BUILTIN_FLOW_COMMAND_MAP.has(slug)
}

// ===== Flow Mention 解析 =====

/** Flow mention 正则：只匹配 !flow:slug 格式（由 mention chip 发送） */
const FLOW_MENTION_REGEX = /^([!！]flow:[A-Za-z0-9][A-Za-z0-9_-]*)(?=$|\s)/

/** Flow mention 解析结果 */
export interface FlowMentionParseResult {
  /** 原始 mention 文本（含 ! 前缀，如 !deep-research） */
  mention: string
  /** Flow slug（不含前缀，如 deep-research） */
  slug: string
  /** 是否为内置 Flow */
  isBuiltin: boolean
  /** 内置 Flow 命令（isBuiltin=true 时有值） */
  builtinCommand?: BuiltinFlowCommand
}

/**
 * 从用户消息中解析 Flow mention
 *
 * 匹配规则：消息开头以 ! 开头后跟合法标识符（字母/数字/下划线/连字符）
 * 不匹配 ![（Markdown 图片语法）
 *
 * @param message 用户消息文本
 * @returns 解析结果，未命中返回 null
 */
export function parseFlowMentionMessage(message: string): FlowMentionParseResult | null {
  const trimmed = message.trimStart()

  // 排除 Markdown 图片语法 ![alt](url) 和 ！[alt](url)
  if (trimmed.startsWith('![') || trimmed.startsWith('！[')) return null

  const match = trimmed.match(FLOW_MENTION_REGEX)
  if (!match?.[1]) return null

  const mention: string = match[1]
  const slug = mention.replace(/^[!！]flow:/, '') // 去掉 !flow: / ！flow: 前缀
  const builtinCommand = getBuiltinFlowCommandBySlug(slug)
  const isBuiltin = builtinCommand !== undefined

  return {
    mention,
    slug,
    isBuiltin,
    builtinCommand,
  }
}

/**
 * 判断用户消息是否以 Flow mention 开头
 */
export function isFlowMentionMessage(message: string): boolean {
  return parseFlowMentionMessage(message) !== null
}

/**
 * 构建 Flow mention 的 Agent prompt
 *
 * - 内置 Flow：透传 SDK 斜杠命令（如 /deep-research），SDK 原生识别
 * - 自定义 Flow：注入 scriptPath 指向 flow.js，SDK 通过 Workflow 工具加载执行
 *
 * @param message 用户原始消息（含 !mention）
 * @param options 可选参数
 * @param options.scriptPath 自定义 Flow 的 flow.js 绝对路径
 * @returns 转换后的 prompt 文本
 */
export function buildFlowPrompt(
  message: string,
  options?: { scriptPath?: string },
): string {
  const parsed = parseFlowMentionMessage(message)
  if (!parsed) return message

  if (parsed.isBuiltin && parsed.builtinCommand) {
    const rest = message.trimStart().slice(parsed.mention.length).trim()
    // deep-research: 透传 /deep-research，SDK 原生识别
    // ultracode: 转 ultracode: 关键字，Claude 识别后启动 workflow 模式
    if (parsed.slug === 'ultracode') {
      return rest
        ? `ultracode: ${rest}`
        : 'ultracode: Ask me what task should be turned into a dynamic workflow, then write and run that workflow after I answer.'
    }
    return rest ? `${parsed.builtinCommand.sdkCommand} ${rest}` : parsed.builtinCommand.sdkCommand
  }

  // 自定义 Flow：注入 scriptPath，SDK 通过 Workflow 工具加载执行
  const rest = message.trimStart().slice(parsed.mention.length).trim()
  if (options?.scriptPath) {
    // 引号包裹路径，防止 Windows 空格路径解析错误
    const quotedPath = `"${options.scriptPath}"`
    return rest
      ? `/workflow ${quotedPath} ${rest}`
      : `/workflow ${quotedPath}`
  }

  // 无 scriptPath 时回退：保留原始消息（兼容旧逻辑）
  return message
}
