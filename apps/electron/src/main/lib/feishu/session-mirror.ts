import type {
  AgentSessionMeta,
  FeishuBotConfig,
  FeishuSessionMirrorSettings,
} from '@proma/shared'

export const DEFAULT_FEISHU_SESSION_MIRROR: FeishuSessionMirrorSettings = { mode: 'off' }

export function normalizeFeishuSessionMirrorSettings(
  settings: FeishuSessionMirrorSettings | undefined,
): FeishuSessionMirrorSettings {
  if (!settings) return DEFAULT_FEISHU_SESSION_MIRROR
  if (settings.mode !== 'stream') return { mode: 'off' }
  return { mode: 'stream', botId: settings.botId }
}

export function resolveSessionMirrorBot(
  settings: FeishuSessionMirrorSettings | undefined,
  bots: FeishuBotConfig[],
): FeishuBotConfig | null {
  const normalized = normalizeFeishuSessionMirrorSettings(settings)
  if (normalized.mode === 'off') return null
  if (!normalized.botId) return null
  const bot = bots.find((item) => item.id === normalized.botId)
  if (!bot || !bot.enabled || !bot.appId || !bot.appSecret) return null
  return bot
}

export function buildSessionMirrorGroupName(session: Pick<AgentSessionMeta, 'id' | 'title'>): string {
  const rawTitle = session.title?.trim()
  const title = rawTitle && rawTitle !== '新 Agent 会话'
    ? rawTitle
    : `新会话 ${session.id.slice(0, 8)}`
  return truncateGroupName(`Proma - ${title}`)
}

function truncateGroupName(name: string): string {
  return name.length > 60 ? `${name.slice(0, 57)}...` : name
}
