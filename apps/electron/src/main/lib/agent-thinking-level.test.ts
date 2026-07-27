import { describe, expect, test } from 'bun:test'
import { resolvePiThinkingLevel } from './agent-thinking-level'

describe('Pi thinking level resolver', () => {
  test('Given OpenAI session override When resolving Then uses the per-session level', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: 'off' },
      'openai-codex',
      'gpt-5.5',
    )).toBe('off')
  })

  test.each(['openai', 'openai-responses', 'custom'] as const)(
    'Given third-party %s GPT-5.6 When session has max override Then uses it',
    (provider) => {
      expect(resolvePiThinkingLevel(
        { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
        { openAIThinkingLevel: 'max' },
        provider,
        'gpt-5.6-terra',
      )).toBe('max')
    },
  )

  test('Given a persisted max override When switching to GPT-5.5 Then clamps it to xhigh', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: 'max' },
      'custom',
      'gpt-5.5',
    )).toBe('xhigh')
  })

  test('Given non-OpenAI provider When session has OpenAI override Then keeps global Pi thinking level', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: 'xhigh' },
      'anthropic',
    )).toBe('medium')
  })

  test('Given a Pi catalog capability When session level is unsupported Then clamps with Pi semantics', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { reasoningLevel: 'xhigh' },
      'anthropic',
      'claude-opus-4-6',
      { source: 'pi-catalog', levels: ['off', 'minimal', 'low', 'medium', 'high', 'max'], defaultLevel: 'high' },
    )).toBe('max')
  })

  test('Given no session override When global max effort is selected Then maps it to xhigh', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'max' },
      undefined,
      'openai-responses',
    )).toBe('xhigh')
  })

  test.each([
    ['off', 'off'],
    ['minimal', 'low'],
    ['low', 'low'],
    ['medium', 'high'],
    ['high', 'high'],
    ['xhigh', 'max'],
    ['max', 'max'],
  ] as const)('Given K3 session level %s When resolving Then maps it to %s', (level, expected) => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: level },
      'kimi-coding',
      'k3',
    )).toBe(expected)
  })

  test('Given K3 with no session override When thinking is disabled Then disables thinking', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'disabled' }, agentEffort: 'high' },
      undefined,
      'kimi-coding',
      'k3-256k',
    )).toBe('off')
  })

  test('Given K3 via another channel When resolving Then still applies K3 effort mapping', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: 'xhigh' },
      'ark-coding-plan',
      'k3',
    )).toBe('max')
  })

  test('Given a migrated session When both fields exist Then prefers the neutral reasoning level', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { reasoningLevel: 'low', openAIThinkingLevel: 'max' },
      'kimi-coding',
      'k3',
    )).toBe('low')
  })

  test.each([
    ['off', 'off'],
    ['low', 'high'],
    ['high', 'high'],
    ['xhigh', 'max'],
    ['max', 'max'],
  ] as const)('Given GLM-5.2 session level %s When resolving Then maps it to %s', (level, expected) => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: level },
      'ark-coding-plan',
      'glm-5.2',
    )).toBe(expected)
  })
})
