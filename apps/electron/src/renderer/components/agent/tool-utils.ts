/**
 * 工具活动项的可复用工具函数和常量
 * 从 ToolActivityItem.tsx 中提取，供多处复用
 */

import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bot,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ClipboardList,
  Database,
  Download,
  FilePenLine,
  SquareCheck,
  FileSearch,
  FileText,
  FolderSearch,
  GitBranch,
  Globe,
  ImagePlus,
  Layers,
  List,
  ListChecks,
  LogIn,
  LogOut,
  Map,
  MapPinOff,
  MessageCircleQuestion,
  OctagonX,
  Pencil,
  Plug,
  Radio,
  Search,
  Send,
  Server,
  Terminal,
  UserMinus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'

/** 工具名称到图标组件的映射 */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  Edit: Pencil,
  Write: FilePenLine,
  Read: FileText,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  Task: GitBranch,
  WebFetch: Download,
  WebSearch: Globe,
  NotebookEdit: BookOpen,
  Skill: Zap,
  TodoWrite: ListChecks,
  TodoRead: ClipboardList,
  TaskCreate: SquareCheck,
  TaskUpdate: ListChecks,
  TaskGet: FileSearch,
  TaskList: List,
  TeamCreate: Users,
  TeamDelete: UserMinus,
  Agent: Bot,
  EnterPlanMode: Map,
  ExitPlanMode: MapPinOff,
  generate_image: ImagePlus,
  TaskOutput: Layers,
  TaskStop: OctagonX,
  AskUserQuestion: MessageCircleQuestion,
  CronCreate: CalendarClock,
  CronDelete: CalendarX,
  CronList: CalendarDays,
  RemoteTrigger: Radio,
  EnterWorktree: LogIn,
  ExitWorktree: LogOut,
  ReadMcpResourceTool: Database,
  ListMcpResourcesTool: Server,
  SendMessage: Send,
}

/**
 * 根据工具名称获取对应的图标组件
 * MCP 工具（mcp__serverName__toolName）使用 Plug 图标
 * 未匹配时返回默认的 Wrench 图标
 */
export function getToolIcon(toolName: string): LucideIcon {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName]
  if (toolName.startsWith('mcp__')) return Plug
  return Wrench
}

/** 内置工具显示名称映射 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Edit: '编辑文件',
  Write: '写入文件',
  Read: '读取文件',
  Bash: '执行命令',
  Glob: '搜索文件',
  Grep: '搜索内容',
  Task: '任务工具',
  WebFetch: '抓取网页',
  WebSearch: '搜索网页',
  NotebookEdit: '编辑笔记本',
  Skill: '使用技能',
  TodoWrite: '更新待办',
  TodoRead: '阅读待办',
  TaskCreate: '创建任务',
  TaskUpdate: '更新任务',
  TaskGet: '加载任务',
  TaskList: '任务列表',
  TeamCreate: '创建 Agent Teams',
  TeamDelete: '删除 Agent Teams',
  Agent: 'Agent',
  EnterPlanMode: '正在生成计划',
  ExitPlanMode: '正在退出计划',
  generate_image: '生成图片',
  TaskOutput: '获取任务输出',
  TaskStop: '停止任务',
  AskUserQuestion: '等待用户输入',
  CronCreate: '创建定时任务',
  CronDelete: '删除定时任务',
  CronList: '列出定时任务',
  RemoteTrigger: '远程触发器',
  EnterWorktree: '进入 Worktree',
  ExitWorktree: '退出 Worktree',
  ReadMcpResourceTool: '读取 MCP 资源',
  ListMcpResourcesTool: '列出 MCP 资源',
  SendMessage: '发送消息',
}

/**
 * 获取工具的显示名称
 * MCP 工具解析为 "serverName / toolName" 格式
 * 内置工具返回中文名称，其余返回原始名称
 */
export function getToolDisplayName(toolName: string): string {
  if (TOOL_DISPLAY_NAMES[toolName]) return TOOL_DISPLAY_NAMES[toolName]
  // MCP 工具：mcp__serverName__toolName → "SERVERNAME / TOOLNAME"
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3 && parts[1]) {
    return `${parts[1].toUpperCase()} / ${parts.slice(2).join('_').toUpperCase()}`
  }
  return toolName
}

/**
 * 根据工具名称和输入参数生成简洁的摘要文本
 * 用于在工具活动列表中展示关键信息
 */
export function getInputSummary(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  switch (toolName) {
    case 'Bash': {
      const command = input.command
      if (typeof command === 'string') {
        return command.length > 80 ? command.slice(0, 80) + '…' : command
      }
      return null
    }

    case 'Grep': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        return `/${pattern}/`
      }
      return null
    }

    case 'Glob': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        return pattern
      }
      return null
    }

    case 'WebFetch': {
      const url = input.url
      if (typeof url === 'string') {
        return url.length > 60 ? url.slice(0, 60) + '…' : url
      }
      return null
    }

    case 'WebSearch': {
      const query = input.query
      if (typeof query === 'string') {
        return query.length > 60 ? query.slice(0, 60) + '…' : query
      }
      return null
    }

    case 'Skill': {
      const skill = input.skill
      if (typeof skill === 'string') {
        return skill
      }
      return null
    }

    case 'Task': {
      const description = input.description ?? input.prompt
      if (typeof description === 'string') {
        return description.length > 80
          ? description.slice(0, 80) + '…'
          : description
      }
      return null
    }

    case 'TaskCreate': {
      const subject = input.subject
      if (typeof subject === 'string') {
        return subject
      }
      return null
    }

    case 'TaskUpdate': {
      const statusMap: Record<string, string> = {
        pending: '待处理',
        in_progress: '正在进行中',
        completed: '已结束',
        cancelled: '已取消',
        blocked: '已阻塞',
        error: '出错',
      }
      const parts: string[] = []
      if (typeof input.taskId === 'string') {
        parts.push(`任务 #${input.taskId}`)
      }
      if (typeof input.status === 'string') {
        parts.push(statusMap[input.status] ?? input.status)
      }
      if (typeof input.subject === 'string') {
        parts.push(input.subject)
      }
      return parts.length > 0 ? parts.join(' ') : null
    }

    case 'TaskGet': {
      const taskId = input.taskId
      if (typeof taskId === 'string') {
        return `#${taskId}`
      }
      return null
    }

    case 'TaskList': {
      const reason = input.reason
      if (typeof reason === 'string') {
        return reason
      }
      return null
    }

    case 'Read':
    case 'Edit':
    case 'Write': {
      const filePath = input.file_path
      if (typeof filePath === 'string') {
        // 仅展示文件名，不展示完整路径
        return filePath.split('/').pop() ?? filePath
      }
      return null
    }

    case 'NotebookEdit': {
      const notebookPath = input.notebook_path
      if (typeof notebookPath === 'string') {
        return notebookPath.split('/').pop() ?? notebookPath
      }
      return null
    }

    case 'TodoWrite': {
      const todos = input.todos
      if (Array.isArray(todos)) {
        return `${todos.length} 项待办`
      }
      return null
    }

    case 'TeamCreate': {
      const parts: string[] = []
      if (typeof input.team_name === 'string') {
        parts.push(input.team_name)
      }
      if (typeof input.description === 'string') {
        parts.push(input.description)
      }
      return parts.length > 0 ? parts.join(' · ') : null
    }

    case 'Agent': {
      const parts: string[] = []
      if (typeof input.name === 'string') {
        parts.push(input.name)
      }
      const detail = input.description ?? input.prompt
      if (typeof detail === 'string') {
        parts.push(detail)
      }
      return parts.length > 0 ? parts.join(' · ') : null
    }

    case 'generate_image': {
      const prompt = input.prompt
      if (typeof prompt === 'string') {
        return prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt
      }
      return null
    }

    case 'TaskOutput':
    case 'TaskStop': {
      const taskId = input.task_id ?? input.taskId
      if (typeof taskId === 'string') return `#${taskId}`
      return null
    }

    case 'AskUserQuestion': {
      const questions = input.questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0] as Record<string, unknown>
        if (typeof first.question === 'string') {
          return first.question.length > 60 ? first.question.slice(0, 60) + '…' : first.question
        }
      }
      return null
    }

    case 'CronCreate': {
      const cron = input.cron
      const prompt = input.prompt
      if (typeof cron === 'string' && typeof prompt === 'string') {
        const truncated = prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt
        return `${cron} · ${truncated}`
      }
      if (typeof cron === 'string') return cron
      return null
    }

    case 'CronDelete': {
      const id = input.id
      if (typeof id === 'string') return id
      return null
    }

    case 'RemoteTrigger': {
      const action = input.action
      const triggerId = input.trigger_id
      if (typeof action === 'string' && typeof triggerId === 'string') return `${action} · ${triggerId}`
      if (typeof action === 'string') return action
      return null
    }

    case 'EnterWorktree': {
      const name = input.name
      if (typeof name === 'string') return name
      return null
    }

    case 'ExitWorktree': {
      const action = input.action
      if (action === 'remove') return '移除 Worktree'
      if (action === 'keep') return '保留 Worktree'
      return null
    }

    case 'CronList':
      return null

    case 'ReadMcpResourceTool': {
      const uri = input.uri
      if (typeof uri === 'string') return uri.length > 60 ? uri.slice(0, 60) + '…' : uri
      return null
    }

    case 'ListMcpResourcesTool': {
      const server = input.server
      if (typeof server === 'string') return server
      return null
    }

    case 'SendMessage': {
      const to = input.to
      if (typeof to === 'string') return to
      return null
    }

    default:
      return null
  }
}

/**
 * 从工具输入参数中提取文件路径
 * 按优先级依次检查常见的路径字段名
 */
export function extractFilePath(
  input: Record<string, unknown>
): string | null {
  const value =
    input.file_path ?? input.filePath ?? input.path ?? input.notebook_path
  if (typeof value === 'string') {
    return value
  }
  return null
}

/**
 * 计算 Edit 工具的差异统计（新增/删除行数）
 * 仅对 Edit 工具有效，其他工具返回 null
 */
export function computeDiffStats(
  toolName: string,
  input: Record<string, unknown>
): { additions: number; deletions: number } | null {
  if (toolName !== 'Edit') {
    return null
  }

  const oldString = input.old_string
  const newString = input.new_string

  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return null
  }

  const oldLines = oldString ? oldString.split('\n').length : 0
  const newLines = newString ? newString.split('\n').length : 0

  return {
    additions: newLines,
    deletions: oldLines,
  }
}

/**
 * 将秒数格式化为可读的耗时字符串
 * 60 秒以内显示 "X.Xs"，超过 60 秒显示 "Xm Ys"
 */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

/** 文件扩展名到语言标识的映射 */
const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  json: 'json',
  jsonl: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'mdx',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'shellscript',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  env: 'shellscript',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
}

/**
 * 根据文件路径推断语法高亮语言标识
 * 返回 Shiki 可识别的语言 ID，未知扩展名返回 'text'
 */
export function inferLanguageFromPath(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath
  // 处理无扩展名的特殊文件
  const lowerBasename = basename.toLowerCase()
  if (lowerBasename === 'dockerfile') return 'dockerfile'
  if (lowerBasename === 'makefile' || lowerBasename === 'gnumakefile') return 'makefile'
  if (lowerBasename.startsWith('.env')) return 'shellscript'

  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1) return 'text'
  const ext = basename.slice(dotIndex + 1).toLowerCase()
  return EXT_LANGUAGE_MAP[ext] ?? 'text'
}
