import type { SlackAppManifestResult } from '@proma/shared'

export interface SlackManifestOptions {
  botName?: string
  description?: string
}

/** 生成可直接粘贴到 Slack「From an app manifest」流程的频道 Socket Mode Manifest。 */
export function buildSlackManifest(options: SlackManifestOptions = {}): SlackAppManifestResult {
  const botName = options.botName?.trim() || 'Proma'
  const manifest: Record<string, unknown> = {
    display_information: {
      name: botName,
      description: options.description?.trim() || 'Your local-first Proma Agent on Slack',
      background_color: '#171717',
    },
    features: {
      bot_user: {
        display_name: botName,
        always_online: false,
      },
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: false,
        messages_tab_read_only_enabled: false,
      },
    },
    oauth_config: {
      scopes: {
        // History scopes are required only to continue an already @mentioned thread.
        bot: ['app_mentions:read', 'channels:history', 'groups:history', 'chat:write'],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ['app_mention', 'message.channels', 'message.groups'],
      },
      interactivity: { is_enabled: true },
      socket_mode_enabled: true,
      org_deploy_enabled: false,
      token_rotation_enabled: false,
    },
  }

  return { manifest, json: `${JSON.stringify(manifest, null, 2)}\n` }
}
