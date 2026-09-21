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
  test('Given official Proma GPT-5.6 model When session has a persisted max override Then uses it', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: 'max' },
      'proma',
      'gpt-5.6-terra',
    )).toBe('max')
  })
  test('Given non-reasoning Proma model When session has an OpenAI override Then keeps global Pi thinking level', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: 'xhigh' },
      'proma',
      'gpt-5-chat-latest',
    )).toBe('medium')
  })
  test.each(['openai', 'openai-responses', 'custom'] as const)('Given third-party %s GPT-5.6 When session has max override Then uses it', (provider) => {
    expect(resolvePiThinkingLevel({ agentThinking: { type: 'adaptive' }, agentEffort: 'medium' }, { openAIThinkingLevel: 'max' }, provider, 'gpt-5.6-terra')).toBe('max')
  })
  test('Given a persisted max override When switching to GPT-5.5 Then clamps it to xhigh', () => {
    expect(resolvePiThinkingLevel({ agentThinking: { type: 'adaptive' }, agentEffort: 'medium' }, { openAIThinkingLevel: 'max' }, 'custom', 'gpt-5.5')).toBe('xhigh')
  })
  test('Given non-OpenAI provider When session has OpenAI override Then keeps global Pi thinking level', () => {
    expect(resolvePiThinkingLevel({ agentThinking: { type: 'adaptive' }, agentEffort: 'medium' }, { openAIThinkingLevel: 'xhigh' }, 'anthropic')).toBe('medium')
  })
  test('Given no session override When global max effort is selected Then maps it to xhigh', () => {
    expect(resolvePiThinkingLevel({ agentThinking: { type: 'adaptive' }, agentEffort: 'max' }, undefined, 'openai-responses')).toBe('xhigh')
  })

  test('Given GLM-5.3 and a disabled legacy setting When resolving Then keeps lightweight reasoning enabled', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'disabled' }, agentEffort: 'high' },
      { reasoningLevel: 'off' },
      'zhipu',
      'glm-5.3',
    )).toBe('low')
  })

  test('Given GLM-5.3 and no override When resolving Then defaults to max reasoning', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' } },
      undefined,
      'zhipu-coding',
      'glm-5.3',
    )).toBe('max')
  })
  test('Given GLM-5.3-FlashX and no override When resolving Then defaults to max reasoning', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' } },
      undefined,
      'zhipu',
      'glm-5.3-flashx',
    )).toBe('max')
  })
})

test('Given a new reasoningLevel When legacy level also exists Then the new field wins', () => {
  expect(resolvePiThinkingLevel(
    { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
    { reasoningLevel: 'low', openAIThinkingLevel: 'max' },
    'openai-responses',
    'gpt-5.6-terra',
  )).toBe('low')
})

test('Given an official Proma standard GPT model When max is selected Then it clamps to xhigh', () => {
  expect(resolvePiThinkingLevel(
    { agentThinking: { type: 'adaptive' }, agentEffort: 'max' },
    undefined,
    'proma',
    'gpt-5.5',
  )).toBe('xhigh')
})

test('Given an official Proma GPT-5.6 model When global max is selected Then it remains max', () => {
  expect(resolvePiThinkingLevel(
    { agentThinking: { type: 'adaptive' }, agentEffort: 'max' },
    undefined,
    'proma',
    'gpt-5.6-terra',
  )).toBe('max')
})

test('Given disabled thinking and a reasoning profile When resolving Then it returns off', () => {
  expect(resolvePiThinkingLevel(
    { agentThinking: { type: 'disabled' }, agentEffort: 'max' },
    undefined,
    'openai-responses',
    'gpt-5.6-terra',
  )).toBe('off')
})

test('Given a catalog-only capability When resolving Then it normalizes within its levels', () => {
  expect(resolvePiThinkingLevel(
    { agentThinking: { type: 'adaptive' }, agentEffort: 'max' },
    undefined,
    'anthropic',
    'catalog-only-model',
    { source: 'pi-catalog', levels: ['off', 'low', 'high'], defaultLevel: 'high' },
  )).toBe('high')
})
