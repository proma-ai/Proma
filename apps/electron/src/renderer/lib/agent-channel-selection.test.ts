import { describe, expect, test } from 'bun:test'
import { getEnabledClaudeAgentChannelIds } from './agent-channel-selection'

describe('getEnabledClaudeAgentChannelIds', () => {
  test('uses the channel enabled state as the only Claude availability switch', () => {
    expect(getEnabledClaudeAgentChannelIds([
      { id: 'anthropic', provider: 'anthropic', enabled: true },
      { id: 'custom', provider: 'custom', enabled: true },
      { id: 'disabled-kimi', provider: 'kimi-api', enabled: false },
    ])).toEqual(['anthropic'])
  })
})
