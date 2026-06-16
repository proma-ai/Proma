/**
 * Agent 会话管理 MCP 工具
 *
 * 通过 SDK MCP Server 暴露 Proma 的会话管理能力，让 Agent 可以：
 * - 列出渠道、工作区、会话
 * - 查询会话详情、上下文用量、消息历史
 * - 创建新会话、Fork 会话、向会话发送消息
 *
 * 这些工具服务于 Agent 内部的会话间协作，不经过渲染进程 IPC。
 */

import {
  createAgentSession,
  forkAgentSession,
  listAgentSessions,
  getAgentSessionMeta,
  updateAgentSessionMeta,
  getAgentSessionSDKMessages,
} from './agent-session-manager'
import { runAgentHeadless } from './agent-service'
import { listChannels, getChannelById } from './channel-manager'
import { listAgentWorkspaces, getAgentWorkspace } from './agent-workspace-manager'

interface SessionToolContext {
  sessionId: string
  workspaceSlug: string
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

export async function injectSessionMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  ctx: SessionToolContext,
): Promise<void> {
  const { z } = await import('zod')
  const { sessionId: sourceSessionId } = ctx

  const server = sdk.createSdkMcpServer({
    name: 'session',
    version: '1.0.0',
    tools: [

      sdk.tool(
        'get_my_session_id',
        'Get YOUR CURRENT session ID. Use this whenever you need to reference yourself.',
        {},
        async () => jsonResult({ session_id: sourceSessionId }),
        { annotations: { readOnlyHint: true } },
      ),

      sdk.tool(
        'list_channels',
        'List all configured AI channels and their available agent models.',
        {},
        async () => {
          const channels = listChannels()
          return jsonResult({
            channels: channels.map((c) => ({
              id: c.id, name: c.name, provider: c.provider, enabled: !!c.enabled,
              agent_models: (c.models || []).filter((m) => m.enabled !== false).map((m) => ({ id: m.id, name: m.name })),
            })),
          })
        },
        { annotations: { readOnlyHint: true } },
      ),

      sdk.tool(
        'list_workspaces',
        'List all agent workspaces. Use this to find workspace IDs.',
        {},
        async () => {
          const workspaces = listAgentWorkspaces()
          return jsonResult({
            workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, created_at: w.createdAt, updated_at: w.updatedAt })),
          })
        },
        { annotations: { readOnlyHint: true } },
      ),

      sdk.tool(
        'list_sessions',
        'List all agent sessions with metadata (title, channel, model, workspace name/ID, archived status).',
        {
          include_archived: z.boolean().optional().describe('Include archived sessions (default: false)'),
          workspace_id: z.string().optional().describe('Filter by workspace ID. Omit to see all workspaces.'),
          limit: z.number().min(1).max(200).optional().describe('Max results (default: 50)'),
        },
        async (args) => {
          let all = listAgentSessions()
          all = args.include_archived ? all : all.filter((s) => !s.archived)
          if (args.workspace_id) all = all.filter((s) => s.workspaceId === args.workspace_id)
          const limited = all.slice(0, args.limit ?? 50)
          const wsNames: Record<string, string> = {}
          try { for (const w of listAgentWorkspaces()) wsNames[w.id] = w.name } catch (_) {}
          return jsonResult({
            count: limited.length, total: all.length,
            sessions: limited.map((s) => ({
              id: s.id, title: s.title, channel_id: s.channelId, model_id: s.modelId,
              workspace_id: s.workspaceId, workspace_name: wsNames[s.workspaceId ?? ''] || null,
              pinned: !!s.pinned, archived: !!s.archived, permission_mode: s.permissionMode,
              created_at: s.createdAt, updated_at: s.updatedAt,
            })),
          })
        },
        { annotations: { readOnlyHint: true } },
      ),

      sdk.tool(
        'get_session_info',
        'Get detailed information about a specific agent session.',
        { session_id: z.string().describe('The session ID to look up') },
        async (args) => {
          const meta = getAgentSessionMeta(args.session_id)
          if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` })
          let channelInfo = null, workspaceInfo = null
          if (meta.channelId) { const ch = getChannelById(meta.channelId); if (ch) channelInfo = { id: ch.id, name: ch.name, provider: ch.provider } }
          if (meta.workspaceId) { const ws = getAgentWorkspace(meta.workspaceId); if (ws) workspaceInfo = { id: ws.id, name: ws.name, slug: ws.slug } }
          return jsonResult({
            id: meta.id, title: meta.title, channel_id: meta.channelId, model_id: meta.modelId,
            channel: channelInfo, workspace: workspaceInfo,
            pinned: !!meta.pinned, archived: !!meta.archived, permission_mode: meta.permissionMode,
            attached_directories: meta.attachedDirectories || [], attached_files: meta.attachedFiles || [],
            created_at: meta.createdAt, updated_at: meta.updatedAt,
          })
        },
        { annotations: { readOnlyHint: true } },
      ),

      sdk.tool(
        'get_session_context',
        'Get current context/token usage of an agent session. Returns input/output/cache tokens and context window size.',
        { session_id: z.string().describe('The session ID to check context usage for.') },
        async (args) => {
          const meta = getAgentSessionMeta(args.session_id)
          if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` })
          let usage: Record<string, number> | null = null, lastModel: string | null = null, contextWindow: number | null = null, fallbackMsg: string | null = null
          try {
            const msgs = getAgentSessionSDKMessages(args.session_id)
            if (msgs?.length) for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i] as Record<string, unknown>
              if (m.type === 'result') {
                usage = (m.usage || null) as Record<string, number> | null
                const mu = m.modelUsage as Record<string, { contextWindow?: number }> | undefined
                if (mu) { const keys = Object.keys(mu); if (keys.length > 0) { lastModel = keys[0]; contextWindow = mu[lastModel]?.contextWindow ?? null } }
                break
              }
              if ((m._errorCode as string) === 'billing_error' && !fallbackMsg) fallbackMsg = 'Last turn failed: billing error.'
            }
          } catch (_) {}
          if (!lastModel) lastModel = meta.modelId ?? null
          if (!usage) return jsonResult({ session_id: args.session_id, title: meta.title, model: lastModel, context_window: contextWindow, message: fallbackMsg || 'No usage data yet.' })
          const input = (usage.input_tokens || 0) as number, output = (usage.output_tokens || 0) as number, cache = ((usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)) as number
          return jsonResult({ session_id: args.session_id, title: meta.title, model: lastModel, context_window: contextWindow, usage: { input_tokens: input, output_tokens: output, cache_tokens: cache, total: input + output + cache, usage_pct: contextWindow ? ((input + output + cache) / contextWindow * 100).toFixed(1) + '%' : null } })
        },
        { annotations: { readOnlyHint: true } },
      ),

      sdk.tool(
        'list_messages',
        'List messages (conversation history) for an agent session. Each message includes UUID, role, timestamp, and text content.',
        { session_id: z.string().describe('Session ID'), limit: z.number().min(1).max(200).optional().describe('Max messages (default: 50)'), offset: z.number().min(0).optional().describe('Skip first N (default: 0)') },
        async (args) => {
          if (!getAgentSessionMeta(args.session_id)) return jsonResult({ error: `Session not found: ${args.session_id}` })
          try {
            const msgs = getAgentSessionSDKMessages(args.session_id)
            if (!msgs?.length) return jsonResult({ session_id: args.session_id, messages: [], count: 0, total: 0 })
            const offset = args.offset ?? 0, limit = Math.min(args.limit ?? 50, 200), slice = msgs.slice(offset, offset + limit)
            return jsonResult({ session_id: args.session_id, count: slice.length, total: msgs.length, offset, messages: slice.map((rawM, i) => {
              const m = rawM as Record<string, unknown>, e: Record<string, unknown> = { index: offset + i, type: m.type, uuid: m.uuid || null, timestamp: m._createdAt || m.timestamp || null, role: (m.message && (m.message as Record<string, unknown>).role) || (m.type === 'user' ? 'user' : m.type === 'assistant' ? 'assistant' : null) }
              if (m.type === 'result') { e.subtype = m.subtype || null; e.duration_ms = m.duration_ms || null; if (m.usage) e.usage = { input_tokens: (m.usage as any).input_tokens || 0, output_tokens: (m.usage as any).output_tokens || 0, cache_tokens: ((m.usage as any).cache_read_input_tokens || 0) + ((m.usage as any).cache_creation_input_tokens || 0) }; if (m.result) e.result_text = String(m.result).slice(0, 500) }
              const mc = (m.message as any)?.content; if (mc) { const ts = mc.filter((c: any) => c.type === 'text' && c.text).map((c: any) => c.text); if (ts.length > 0) { e.text = ts.join('\n').slice(0, 500); e.text_full_length = ts.join('\n').length } }
              if (m._errorCode) e.error_code = m._errorCode
              return e
            }) })
          } catch (err) { return jsonResult({ error: `Read failed: ${err instanceof Error ? err.message : String(err)}` }) }
        },
        { annotations: { readOnlyHint: true } },
      ),

      sdk.tool(
        'create_session',
        'Create a NEW agent session with specified channel and model.',
        { channel_id: z.string().describe('Channel ID'), model_id: z.string().optional().describe('Model ID'), title: z.string().optional().describe('Session title'), workspace_id: z.string().optional().describe('Workspace ID') },
        async (args) => {
          const channel = getChannelById(args.channel_id)
          if (!channel) return jsonResult({ error: `Channel not found: "${args.channel_id}".` })
          let mid = args.model_id; if (!mid) { const f = channel.models?.find((m) => m.enabled !== false); if (f) mid = f.id }
          if (!mid) return jsonResult({ error: `No enabled models for channel "${channel.name}".` })
          try { const meta = createAgentSession(args.title, args.channel_id, args.workspace_id, mid); return jsonResult({ session: { id: meta.id, title: meta.title, channel_id: meta.channelId, model_id: meta.modelId, workspace_id: meta.workspaceId, created_at: meta.createdAt }, message: `Created: ${meta.title}` }) } catch (err) { return jsonResult({ error: `Failed: ${err instanceof Error ? err.message : String(err)}` }) }
        },
      ),

      sdk.tool(
        'fork_session',
        'FORK (clone) an existing agent session, preserving context up to the specified point.',
        { source_session_id: z.string().describe('Source session ID'), up_to_message_uuid: z.string().optional().describe('Fork at this message UUID'), title: z.string().optional(), new_channel_id: z.string().optional(), new_model_id: z.string().optional(), new_workspace_id: z.string().optional() },
        async (args) => {
          const source = getAgentSessionMeta(args.source_session_id)
          if (!source) return jsonResult({ error: `Source not found: "${args.source_session_id}".` })
          if (!source.sdkSessionId) return jsonResult({ error: `Cannot fork: no SDK session yet.` })
          try {
            const forked = await forkAgentSession({ sessionId: args.source_session_id, upToMessageUuid: args.up_to_message_uuid })
            const updates: Record<string, unknown> = {}; if (args.title) updates.title = args.title; if (args.new_channel_id) updates.channelId = args.new_channel_id; if (args.new_model_id) updates.modelId = args.new_model_id; if (args.new_workspace_id) updates.workspaceId = args.new_workspace_id
            if (Object.keys(updates).length > 0) { updateAgentSessionMeta(forked.id, updates); Object.assign(forked, updates) }
            return jsonResult({ session: { id: forked.id, title: forked.title, channel_id: forked.channelId, model_id: forked.modelId, workspace_id: forked.workspaceId, source_session_id: args.source_session_id, created_at: forked.createdAt }, message: `Forked: ${forked.title}` })
          } catch (err) { return jsonResult({ error: `Fork failed: ${err instanceof Error ? err.message : String(err)}` }) }
        },
      ),

      sdk.tool(
        'send_message',
        'Send a user message to an EXISTING agent session for autonomous processing. wait=true returns reply text.',
        { session_id: z.string().describe('Target session ID'), message: z.string().describe('Message to send'), wait: z.boolean().optional().describe('Wait for completion (default: true)'), notify: z.boolean().optional().describe('Async callback to calling session (internal only)'), model_id: z.string().optional(), channel_id: z.string().optional() },
        async (args) => {
          const meta = getAgentSessionMeta(args.session_id)
          if (!meta) return jsonResult({ error: `Target not found: "${args.session_id}".` })
          const channelId = args.channel_id || meta.channelId; if (!channelId) return jsonResult({ error: 'No channel available.' })
          const modelId = args.model_id || meta.modelId, shouldWait = args.wait !== false, shouldNotify = args.notify === true
          let sourceChannelId: string | undefined
          if (shouldNotify && sourceSessionId) { const sm = getAgentSessionMeta(sourceSessionId); sourceChannelId = sm?.channelId }
          try {
            const result = await new Promise<{ status: string }>((resolve, reject) => {
              runAgentHeadless({ sessionId: args.session_id, userMessage: args.message, channelId, modelId, workspaceId: meta.workspaceId, permissionModeOverride: 'bypassPermissions' }, {
                onComplete: () => { if (shouldNotify && sourceSessionId && sourceChannelId) try { runAgentHeadless({ sessionId: sourceSessionId, userMessage: `[通知] 目标已完成: ${meta.title}`, channelId: sourceChannelId, permissionModeOverride: 'bypassPermissions' }, { onComplete: () => {}, onError: () => {}, onTitleUpdated: () => {} }) } catch (_) {} if (shouldWait) resolve({ status: 'completed' }) },
                onError: (e) => { if (shouldWait) reject(new Error(e)) },
                onTitleUpdated: (t) => { try { updateAgentSessionMeta(args.session_id, { title: t }) } catch (_) {} },
              })
              if (!shouldWait) resolve({ status: 'started' })
            })
            if (result.status === 'started') return jsonResult({ session_id: args.session_id, status: 'started' })
            let reply: string | null = null
            try { const msgs = getAgentSessionSDKMessages(args.session_id); if (msgs?.length) for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i] as any; if (m.type === 'assistant' && m.message?.content) { const ts = m.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text); if (ts.length > 0) { reply = ts.join('\n'); break } } if (m.type === 'result' && m.result) { reply = String(m.result); break } } } catch (_) {}
            return jsonResult({ session_id: args.session_id, status: 'completed', reply })
          } catch (err) { return jsonResult({ session_id: args.session_id, status: 'error', error: err instanceof Error ? err.message : String(err) }) }
        },
      ),

    ],
  })

  mcpServers['session'] = server as unknown as Record<string, unknown>
}
