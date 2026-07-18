import { describe, expect, test } from 'bun:test'
import { nextAgentChannelIdsAfterModelSelect } from './agent-channel-selection'

describe('nextAgentChannelIdsAfterModelSelect', () => {
  test('adds the selected channel for Claude runtime', () => {
    expect(nextAgentChannelIdsAfterModelSelect(['anthropic'], 'kimi', 'claude')).toEqual(['anthropic', 'kimi'])
  })

  test('keeps the list unchanged when Claude channel is already present', () => {
    const channelIds = ['anthropic', 'kimi']
    expect(nextAgentChannelIdsAfterModelSelect(channelIds, 'kimi', 'claude')).toBe(channelIds)
  })

  test('does not mark Pi-selected channels as Claude-compatible', () => {
    const channelIds = ['anthropic']
    expect(nextAgentChannelIdsAfterModelSelect(channelIds, 'openai-responses', 'pi')).toBe(channelIds)
  })

  test('does not migrate a Pi default channel into the Claude whitelist', () => {
    const channelIds: string[] = []
    expect(nextAgentChannelIdsAfterModelSelect(channelIds, 'openai-responses', 'pi')).toBe(channelIds)
  })
})
