/**
 * Memory 内置 MCP 工具（Claude runtime）
 *
 * 通过 Claude Agent SDK 的 createSdkMcpServer 暴露 Proma 长期记忆能力：
 * - memory_search：检索记忆（只读）
 * - memory_capture：主动沉淀一条记忆
 * - memory_stats：统计与待确认纠正（只读）
 */

import {
  stats,
  searchAsync,
  searchAsText,
  captureCandidate,
  corrections,
  confirmCorrection,
  rejectCorrection,
} from './service'
import { runAnalysisAndPersist } from '../suggest/service'
import type { MemoryAtomType } from '@proma/shared'

interface MemoryAgentToolContext {
  sessionId: string
  workspaceSlug?: string
}

type ZodModule = typeof import('zod')
const MEMORY_TYPES: MemoryAtomType[] = ['fact', 'preference', 'correction', 'sop', 'todo_context']

function isMemoryType(v: unknown): v is MemoryAtomType {
  return typeof v === 'string' && (MEMORY_TYPES as string[]).includes(v)
}

function buildMemorySchemas(z: ZodModule['z']) {
  return {
    search: {
      query: z.string().describe('检索关键词：用户的自然语言问题或关键主题'),
      limit: z.number().int().min(1).max(20).optional().describe('返回条数上限，默认 5'),
      type: z.enum(['fact', 'preference', 'correction', 'sop', 'todo_context'] as const).optional().describe('按类型过滤'),
      includeUnconfirmed: z.boolean().optional().describe('是否包含未确认条目（默认 false）'),
    },
    capture: {
      content: z.string().describe('要记忆的内容（简洁、自包含、可独立理解的一句话）'),
      type: z.enum(['fact', 'preference', 'correction', 'sop', 'todo_context'] as const).optional().describe('记忆类型，默认 fact'),
      priority: z.number().int().min(0).max(100).optional().describe('重要度 0-100，默认 50'),
    },
    stats: {},
    corrections: {
      status: z.enum(['pending', 'active', 'rejected', 'superseded'] as const).optional().describe('按状态过滤纠正'),
    },
    confirmCorrection: {
      id: z.string().describe('纠正 ID'),
    },
    rejectCorrection: {
      id: z.string().describe('纠正 ID'),
    },
  }
}

/** 注入 memory MCP server（Claude runtime） */
export async function injectMemoryMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  ctx: MemoryAgentToolContext,
): Promise<void> {
  const { z } = await import('zod')
  const schemas = buildMemorySchemas(z)

  const server = sdk.createSdkMcpServer({
    name: 'memory',
    version: '1.0.0',
    tools: [
      sdk.tool(
        'memory_search',
        '检索 Proma 长期记忆。适用于回忆用户偏好、历史事实、行为纠正、可复用流程等关键信息；当上方注入的 memory_context 不足时主动调用。',
        schemas.search,
        async (args) => {
          const query = typeof args.query === 'string' ? args.query.trim() : ''
          if (!query) throw new Error('query 必填')
          const result = await searchAsync({
            query,
            limit: typeof args.limit === 'number' ? args.limit : undefined,
            type: isMemoryType(args.type) ? args.type : undefined,
            includeUnconfirmed: args.includeUnconfirmed === true,
          })
          return {
            content: [{ type: 'text' as const, text: searchAsText({ query, limit: typeof args.limit === 'number' ? args.limit : undefined, includeUnconfirmed: args.includeUnconfirmed === true }) }],
            details: result,
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'memory_capture',
        '主动沉淀当前对话上下文为一条长期记忆。适用于用户明确要求记住、提到长期偏好/纠正、或你判断该信息跨会话有用时。',
        schemas.capture,
        async (args) => {
          const content = typeof args.content === 'string' ? args.content.trim() : ''
          if (!content) throw new Error('content 必填')
          const type = isMemoryType(args.type) ? args.type : 'fact'
          const priority = typeof args.priority === 'number' ? args.priority : 50
          const result = captureCandidate(
            { content, type, priority },
            { sessionId: ctx.sessionId, workspaceSlug: ctx.workspaceSlug },
          )
          return {
            content: [{ type: 'text' as const, text: result.deduplicated ? '记忆已与已有条目合并更新。' : '记忆已保存。' }],
            details: result,
          }
        },
      ),
      sdk.tool(
        'memory_stats',
        '查看 Proma 长期记忆统计：记忆数量、类型分布、场景数、待确认纠正。',
        schemas.stats,
        async () => {
          const s = stats()
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(s, null, 2) }],
            details: s,
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'memory_corrections',
        '查看行为纠正候选列表（用户对 Agent 的改进要求）。',
        schemas.corrections,
        async (args) => {
          const status = typeof args.status === 'string' ? args.status as 'pending' | 'active' | 'rejected' | 'superseded' : undefined
          const items = corrections(status)
          return {
            content: [{ type: 'text' as const, text: items.length === 0 ? '暂无纠正记录。' : JSON.stringify(items, null, 2) }],
            details: { corrections: items },
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'memory_confirm_correction',
        '确认一条行为纠正候选生效（会同步沉淀为长期记忆）。',
        schemas.confirmCorrection,
        async (args) => {
          const id = typeof args.id === 'string' ? args.id.trim() : ''
          if (!id) throw new Error('id 必填')
          const ok = confirmCorrection(id)
          if (!ok) throw new Error(`纠正不存在: ${id}`)
          return { content: [{ type: 'text' as const, text: '纠正已确认生效。' }] }
        },
      ),
      sdk.tool(
        'memory_reject_correction',
        '拒绝一条行为纠正候选（不写入记忆）。',
        schemas.rejectCorrection,
        async (args) => {
          const id = typeof args.id === 'string' ? args.id.trim() : ''
          if (!id) throw new Error('id 必填')
          const ok = rejectCorrection(id)
          if (!ok) throw new Error(`纠正不存在: ${id}`)
          return { content: [{ type: 'text' as const, text: '纠正已拒绝。' }] }
        },
      ),
      sdk.tool(
        'suggestion_analyze',
        '分析工作模式：用 LLM 分析近期记忆，发现重复出现的工作模式（周期任务/SOP/待沉淀偏好），生成主动建议候选。适用于定时任务中定期运行，或用户主动要求分析工作模式时调用。',
        {},
        async () => {
          const added = await runAnalysisAndPersist()
          return { content: [{ type: 'text' as const, text: `工作模式分析完成，新增 ${added} 条建议。` }] }
        },
      ),
    ],
  })

  mcpServers['memory'] = server as unknown as Record<string, unknown>
}
