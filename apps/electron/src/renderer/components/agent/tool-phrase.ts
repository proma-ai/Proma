/**
 * 工具语义化短语生成器
 *
 * 将工具名 + 输入参数合成为一句连贯、可读的中文短语，
 * 用于工具活动行的收起态展示和 Loading 态展示。
 */

import { computeDiffStats } from './tool-utils'

/** 工具短语 */
export interface ToolPhrase {
  /** 完成态/收起态短语，如 "读取 foo.ts 第 10-60 行" */
  label: string
  /** Loading 态短语，如 "正在读取 foo.ts..." */
  loadingLabel: string
}

/** 从路径中提取文件名 */
function filename(path: string): string {
  return path.split('/').pop() ?? path
}

/** 截断文本 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/**
 * 根据工具名和输入参数生成语义化短语
 *
 * 返回的 label 应读起来像一个完整动宾短语，无冗余信息。
 */
export function getToolPhrase(toolName: string, input: Record<string, unknown>): ToolPhrase {
  switch (toolName) {
    case 'Read': {
      const fp = input.file_path ?? input.filePath
      if (typeof fp === 'string') {
        const name = filename(fp)
        const offset = typeof input.offset === 'number' ? input.offset : undefined
        const limit = typeof input.limit === 'number' ? input.limit : undefined
        if (offset !== undefined && limit !== undefined) {
          return phrase(`读取 ${name} 第 ${offset}-${offset + limit} 行`)
        }
        if (offset !== undefined) {
          return phrase(`读取 ${name} 从第 ${offset} 行`)
        }
        return phrase(`读取 ${name}`)
      }
      return phrase('读取文件')
    }

    case 'Edit': {
      const fp = input.file_path ?? input.filePath
      const name = typeof fp === 'string' ? filename(fp) : '文件'
      const diff = computeDiffStats('Edit', input)
      if (diff) {
        const parts = [name]
        if (diff.additions > 0) parts.push(`+${diff.additions}`)
        if (diff.deletions > 0) parts.push(`-${diff.deletions}`)
        return phrase(`编辑 ${parts.join(' ')}`)
      }
      return phrase(`编辑 ${name}`)
    }

    case 'Write': {
      const fp = input.file_path ?? input.filePath
      const name = typeof fp === 'string' ? filename(fp) : '文件'
      return phrase(`写入 ${name}`)
    }

    case 'Bash': {
      const cmd = input.command
      if (typeof cmd === 'string') {
        return phrase(`执行 ${truncate(cmd, 80)}`)
      }
      return phrase('执行命令')
    }

    case 'Grep': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        const parts = [`搜索内容 /${pattern}/`]
        const path = input.path
        const glob = input.glob
        if (typeof glob === 'string') {
          parts.push(`in ${glob}`)
        } else if (typeof path === 'string') {
          parts.push(`in ${path}`)
        }
        return phrase(parts.join(' '))
      }
      return phrase('搜索内容')
    }

    case 'Glob': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        const parts = [`搜索文件 ${pattern}`]
        const path = input.path
        if (typeof path === 'string') {
          parts.push(`in ${path}`)
        }
        return phrase(parts.join(' '))
      }
      return phrase('搜索文件')
    }

    case 'WebFetch': {
      const url = input.url
      if (typeof url === 'string') {
        return phrase(`抓取 ${truncate(url, 60)}`)
      }
      return phrase('抓取网页')
    }

    case 'WebSearch': {
      const query = input.query
      if (typeof query === 'string') {
        return phrase(`搜索 "${truncate(query, 60)}"`)
      }
      return phrase('搜索网页')
    }

    case 'Skill': {
      const skill = input.skill
      if (typeof skill === 'string') {
        return phrase(`使用技能 ${skill}`)
      }
      return phrase('使用技能')
    }

    case 'NotebookEdit': {
      const fp = input.notebook_path
      if (typeof fp === 'string') {
        return phrase(`编辑笔记本 ${filename(fp)}`)
      }
      return phrase('编辑笔记本')
    }

    case 'Task': {
      const desc = input.description ?? input.prompt
      if (typeof desc === 'string') {
        return phrase(`子任务 ${truncate(desc, 80)}`)
      }
      return phrase('子任务')
    }

    case 'Agent': {
      const name = input.name
      const desc = input.description ?? input.prompt
      if (typeof name === 'string' && typeof desc === 'string') {
        return phrase(`Agent ${name} · ${truncate(desc, 60)}`)
      }
      if (typeof desc === 'string') return phrase(`Agent ${truncate(desc, 80)}`)
      if (typeof name === 'string') return phrase(`Agent ${name}`)
      return phrase('Agent')
    }

    case 'TaskCreate': {
      const subject = input.subject
      if (typeof subject === 'string') {
        return phrase(`创建任务 ${truncate(subject, 80)}`)
      }
      return phrase('创建任务')
    }

    case 'TaskUpdate': {
      // TaskUpdate 是自描述工具，label 即完整语义
      const statusMap: Record<string, string> = {
        pending: '待处理',
        in_progress: '进行中',
        completed: '已完成',
        cancelled: '已取消',
        blocked: '已阻塞',
        error: '出错',
        deleted: '已删除',
      }
      const parts: string[] = []
      if (typeof input.taskId === 'string') parts.push(`任务 #${input.taskId}`)
      if (typeof input.status === 'string') parts.push(statusMap[input.status] ?? input.status)
      if (typeof input.subject === 'string') parts.push(truncate(input.subject, 60))
      if (parts.length > 0) return phrase(parts.join(' '))
      return phrase('更新任务')
    }

    case 'TaskGet': {
      const taskId = input.taskId
      if (typeof taskId === 'string') return phrase(`加载任务 #${taskId}`)
      return phrase('加载任务')
    }

    case 'TaskList': {
      return phrase('查看任务列表')
    }

    case 'TodoWrite': {
      const todos = input.todos
      if (Array.isArray(todos)) {
        return phrase(`更新待办 ${todos.length} 项`)
      }
      return phrase('更新待办')
    }

    case 'TodoRead': {
      return phrase('读取待办')
    }

    case 'TeamCreate': {
      const name = input.team_name
      if (typeof name === 'string') return phrase(`创建 Agent Teams ${name}`)
      return phrase('创建 Agent Teams')
    }

    case 'TeamDelete': {
      const name = input.team_name
      if (typeof name === 'string') return phrase(`删除 Agent Teams ${name}`)
      return phrase('删除 Agent Teams')
    }

    case 'EnterPlanMode': {
      return phrase('进入计划模式')
    }

    case 'ExitPlanMode': {
      return phrase('退出计划模式')
    }

    case 'generate_image': {
      const prompt = input.prompt
      if (typeof prompt === 'string') return phrase(`生成图片 ${truncate(prompt, 60)}`)
      return phrase('生成图片')
    }

    case 'TaskOutput': {
      const taskId = input.task_id ?? input.taskId
      if (typeof taskId === 'string') return phrase(`获取任务 #${taskId} 输出`)
      return phrase('获取任务输出')
    }

    case 'TaskStop': {
      const taskId = input.task_id ?? input.taskId
      if (typeof taskId === 'string') return phrase(`停止任务 #${taskId}`)
      return phrase('停止任务')
    }

    case 'AskUserQuestion': {
      const questions = input.questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0] as Record<string, unknown>
        if (typeof first.question === 'string') {
          return phrase(`询问 ${truncate(first.question, 60)}`)
        }
      }
      return phrase('等待用户输入')
    }

    case 'CronCreate': {
      const cron = input.cron
      const prompt = input.prompt
      if (typeof cron === 'string' && typeof prompt === 'string') {
        return phrase(`创建定时任务 ${cron} · ${truncate(prompt, 40)}`)
      }
      if (typeof cron === 'string') return phrase(`创建定时任务 ${cron}`)
      return phrase('创建定时任务')
    }

    case 'CronDelete': {
      const id = input.id
      if (typeof id === 'string') return phrase(`删除定时任务 ${id}`)
      return phrase('删除定时任务')
    }

    case 'CronList': {
      return phrase('列出定时任务')
    }

    case 'RemoteTrigger': {
      const action = input.action
      const triggerId = input.trigger_id
      const actionMap: Record<string, string> = {
        list: '列出',
        get: '获取',
        create: '创建',
        update: '更新',
        run: '运行',
      }
      const actionLabel = typeof action === 'string' ? (actionMap[action] ?? action) : undefined
      if (actionLabel && typeof triggerId === 'string') {
        return phrase(`${actionLabel}远程触发器 ${triggerId}`)
      }
      if (actionLabel) return phrase(`${actionLabel}远程触发器`)
      return phrase('远程触发器')
    }

    case 'EnterWorktree': {
      const name = input.name
      if (typeof name === 'string') return phrase(`进入 Worktree ${name}`)
      return phrase('进入 Worktree')
    }

    case 'ExitWorktree': {
      const action = input.action
      if (action === 'remove') return phrase('退出并删除 Worktree')
      if (action === 'keep') return phrase('退出 Worktree')
      return phrase('退出 Worktree')
    }

    case 'ReadMcpResourceTool': {
      const server = input.server
      const uri = input.uri
      if (typeof server === 'string' && typeof uri === 'string') {
        return phrase(`读取 MCP 资源 ${server} / ${truncate(uri, 40)}`)
      }
      if (typeof uri === 'string') return phrase(`读取 MCP 资源 ${truncate(uri, 60)}`)
      return phrase('读取 MCP 资源')
    }

    case 'ListMcpResourcesTool': {
      const server = input.server
      if (typeof server === 'string') return phrase(`列出 ${server} 的 MCP 资源`)
      return phrase('列出 MCP 资源')
    }

    case 'SendMessage': {
      const to = input.to
      if (typeof to === 'string') return phrase(`发送消息给 ${to}`)
      return phrase('发送消息')
    }

    default: {
      // MCP 工具：mcp__serverName__toolName
      const mcpParts = toolName.split('__')
      if (mcpParts[0] === 'mcp' && mcpParts.length >= 3 && mcpParts[1]) {
        const server = mcpParts[1].toUpperCase()
        const tool = mcpParts.slice(2).join('_')
        // 尝试从 input 中提取第一个有意义的参数作为摘要
        const summary = extractFirstMeaningfulValue(input)
        if (summary) {
          return phrase(`${server} / ${tool} ${truncate(summary, 60)}`)
        }
        return phrase(`${server} / ${tool}`)
      }
      // 未知工具
      const summary = extractFirstMeaningfulValue(input)
      if (summary) {
        return phrase(`${toolName} ${truncate(summary, 60)}`)
      }
      return phrase(toolName)
    }
  }
}

/** 构造短语对 */
function phrase(label: string): ToolPhrase {
  return {
    label,
    loadingLabel: `正在${label}...`,
  }
}

/** 从 input 中提取第一个有意义的字符串值作为摘要 */
function extractFirstMeaningfulValue(input: Record<string, unknown>): string | null {
  // 优先检查常见的描述性字段
  const priorityKeys = ['description', 'prompt', 'query', 'command', 'name', 'subject', 'path', 'file_path', 'url']
  for (const key of priorityKeys) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  // 回退到第一个非下划线开头的字符串值
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith('_') && typeof value === 'string' && value.length > 0 && value.length < 200) {
      return value
    }
  }
  return null
}
