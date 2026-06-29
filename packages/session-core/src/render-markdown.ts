import type { TranscriptTurn, TurnRole } from './transcript'

export interface RenderMarkdownOptions {
  /** 文档标题用的会话 id。 */
  sessionId?: string
  /** 是否输出顶部标题与说明（默认 true）。截取片段时可设 false。 */
  header?: boolean
}

const HEADING: Record<TurnRole, string> = {
  user: '## 用户',
  assistant: '## 助手',
  system: '## 系统',
}

/**
 * 把 TranscriptTurn[] 渲染为干净 Markdown 对话。
 * 连续同角色合并到同一标题下；工具调用以 `> [工具: …]` 引用行呈现。
 */
export function renderTranscriptMarkdown(turns: TranscriptTurn[], opts: RenderMarkdownOptions = {}): string {
  const { sessionId, header = true } = opts
  const lines: string[] = []

  if (header) {
    lines.push(`# Session: ${sessionId ?? ''}`.trimEnd(), '')
    lines.push('> 自动清洗自会话 JSONL，流式快照与工具回包已过滤。', '')
  }

  let currentRole: TurnRole | null = null
  for (const t of turns) {
    if (t.role !== currentRole) {
      lines.push(HEADING[t.role], '')
      currentRole = t.role
    }
    if (t.text) {
      lines.push(t.text, '')
    }
    for (const tool of t.toolSummaries) {
      lines.push(`> [工具: ${tool}]`, '')
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
