/**
 * Proma Cloud MCP Server（Agent 模式）
 *
 * 暴露两个工具：
 *
 * 1. get_credentials — 返回 Agent 内部使用的凭据（Inner Key + baseUrl）
 *    用途：Agent 自己调用 Proma 开放 API（生图、内部 LLM 调用等）
 *
 * 2. create_app_key — 为 Agent 帮用户生成的 AI 应用创建专用 key
 *    用途：proma-build-ai-app Skill 触发时，自动为新应用创建带 quota 的独立 key
 *    重要：不要在 Agent 自用场景下调用此工具
 *
 * 配合 proma-cloud-sdk / proma-build-ai-app / proma-generate-image / proma-gpt-image-2 等 Skill 使用。
 */

import { getCloudApiConfig } from '@proma/cloud'
import {
  ensurePromaAgentInnerKey,
  invalidatePromaAgentInnerKeyCache,
  createPromaAppKey,
} from '../proma-agent-key-service'
import { getBuiltinMcpName } from '../builtin-mcp/baseline'

/**
 * 把管理 API 的 baseUrl 归一化成根域名，供 Agent 拼接 LLM / 工具端点。
 *
 * getCloudApiConfig() 返回的 baseUrl 形如 `https://api.proma.cool/api/v1`（管理 API base，
 * 内部 auth/refresh 等直接用它）。但 Agent 调用的两类开放端点住在不同 base 上：
 *   - LLM（OpenAI/Anthropic 兼容）：`{root}/v1/chat/completions`、`{root}/v1/messages`、`{root}/v1/embeddings`、`{root}/v1/models`
 *   - 工具 / 多模态：`{root}/api/v1/tools/...`、`{root}/api/v1/multimodal-models`
 * 两者唯一一致的锚点是根域名。统一返回根域名后，所有 Skill 的端点拼接才不会出现
 * `/api/v1/v1/...`（LLM）或 `/api/v1/api/v1/tools/...`（工具）这类双重前缀 404。
 */
function toApiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v1\/?$/, '')
}

/** MCP 工具描述 — get_credentials */
const GET_CREDENTIALS_DESCRIPTION =
  'Get Proma API credentials for Agent\'s OWN use (internal LLM batch calls, image generation, etc.). ' +
  'Returns { apiKey, baseUrl } as JSON text. The apiKey is the Agent\'s shared inner key "proma-agent-inner" ' +
  'that the user can revoke from settings. ' +
  'Always call this tool to fetch fresh credentials when YOU need to call a Proma API. ' +
  'DO NOT use this credential inside an app you are building for the user — use create_app_key instead.'

/** MCP 工具描述 — create_app_key */
const CREATE_APP_KEY_DESCRIPTION =
  'Create a DEDICATED, quota-limited API Key for an AI app you are BUILDING FOR THE USER. ' +
  'Use this tool ONLY when generating a standalone app via the proma-build-ai-app Skill (Python CLI, Node CLI, HTML tool, etc.) — ' +
  'NOT for your own internal LLM calls (use get_credentials for that). ' +
  'The key is named "app-<appName>-<YYYYMMDD>", visible to the user in their Proma settings panel, ' +
  'and comes with a Quota Limit (default 50 credits) to protect against unexpected cost. ' +
  'You MUST tell the user: (a) the key name, (b) the quota limit, (c) that they can adjust/delete it from the Proma settings panel. ' +
  'Write the returned apiKey into the app\'s .env file (NOT .env.example).'

/**
 * 注入 Proma Cloud MCP Server 到 Agent 会话
 *
 * 通过 sdk.createSdkMcpServer 创建 SDK MCP Server。
 * 此 MCP 始终注入（用户登录后），不依赖 chat-tools.json 配置。
 */
export async function injectPromaCloudMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<void> {
  const { z } = await import('zod')
  const serverName = getBuiltinMcpName('proma-cloud')

  const server = sdk.createSdkMcpServer({
    name: serverName,
    version: '1.1.0',
    tools: [
      // ===== Tool 1: get_credentials =====
      sdk.tool(
        'get_credentials',
        GET_CREDENTIALS_DESCRIPTION,
        {},
        async () => {
          try {
            const apiKey = await ensurePromaAgentInnerKey()
            const { baseUrl } = getCloudApiConfig()
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ apiKey, baseUrl: toApiRoot(baseUrl) }),
                },
              ],
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            invalidatePromaAgentInnerKeyCache()
            console.error('[Proma Cloud MCP] get_credentials failed:', error)
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to get Proma credentials: ${msg}. The user may not be logged in, or there may be a network issue. Ask the user to check their login status.`,
                },
              ],
            }
          }
        },
      ),

      // ===== Tool 2: create_app_key =====
      sdk.tool(
        'create_app_key',
        CREATE_APP_KEY_DESCRIPTION,
        {
          appName: z
            .string()
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'appName must be kebab-case (lowercase, digits, hyphens)')
            .min(2)
            .max(50)
            .describe(
              'The app name in kebab-case (e.g. "article-polisher", "email-classifier"). Will become part of the key name: "app-<appName>-<YYYYMMDD>".',
            ),
          description: z
            .string()
            .min(1)
            .max(200)
            .describe(
              'User-facing description of what this key is for. Visible in Proma settings panel. Example: "文章润色 CLI 工具的专用 API Key (50 积分上限)".',
            ),
          quotaLimit: z
            .number()
            .positive()
            .optional()
            .describe(
              'Credit cap for this key. Recommended: text-only tools 50, image-generation tools 200, GPT-image-high-quality tools 500. Defaults to 50 if omitted.',
            ),
        },
        async (args) => {
          try {
            const result = await createPromaAppKey({
              appName: args.appName,
              description: args.description,
              quotaLimit: args.quotaLimit,
            })
            const { baseUrl } = getCloudApiConfig()
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    apiKey: result.apiKey,
                    baseUrl: toApiRoot(baseUrl),
                    keyId: result.keyId,
                    keyName: result.keyName,
                    quotaLimit: result.quotaLimit,
                  }),
                },
              ],
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error('[Proma Cloud MCP] create_app_key failed:', error)
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to create app key: ${msg}`,
                },
              ],
            }
          }
        },
      ),
    ],
  })

  mcpServers[serverName] = server as unknown as Record<string, unknown>
  console.log(`[Proma Cloud MCP] 已注入凭据网关 (${serverName}, v1.1.0 — get_credentials + create_app_key)`)
}
