import { describe, expect, test } from 'bun:test'
import { buildPiExtensionFactories } from './pi-agent-adapter'

describe('Pi extension factories', () => {
  test('always loads the Proma Goal extension', () => {
    const factories = buildPiExtensionFactories({
      provider: 'openai',
      modelReasoning: false,
      modelId: 'gpt-4o',
    })

    expect(factories).toHaveLength(1)
  })

  test('preserves Codex request settings alongside the Goal extension', () => {
    const factories = buildPiExtensionFactories({
      provider: 'openai-codex',
      modelReasoning: true,
      modelId: 'gpt-5.6-sol',
      codexFastMode: true,
      openAIThinkingLevel: 'high',
    })

    expect(factories).toHaveLength(2)
  })
})
