import { describe, expect, test } from 'bun:test'
import {
  applyAgentModelRoutingToEnv,
  DEEPSEEK_SUBAGENT_MODEL_ID,
  resolveAgentModelRouting,
} from './agent-model-routing'

describe('Agent 辅助模型路由', () => {
  test('Given DeepSeek V4 Pro When 解析模型路由 Then SubAgent 固定到 DeepSeek V4 Flash', () => {
    const policy = resolveAgentModelRouting({
      modelId: 'deepseek-v4-pro',
      provider: 'deepseek',
    })

    expect(policy.deepSeekFamily).toBe(true)
    expect(policy.subagentModel).toBe(DEEPSEEK_SUBAGENT_MODEL_ID)
  })

  test('Given DeepSeek 兼容渠道模型 When 解析模型路由 Then 仍识别为 DeepSeek 系列', () => {
    const policy = resolveAgentModelRouting({
      modelId: 'gateway/deepseek-v4-pro',
      provider: 'custom',
    })

    expect(policy.deepSeekFamily).toBe(true)
    expect(policy.subagentModel).toBe(DEEPSEEK_SUBAGENT_MODEL_ID)
  })

  test('Given 非 DeepSeek 模型 When 应用模型路由 Then 删除残留的 SubAgent 模型环境变量', () => {
    const env: Record<string, string | undefined> = {
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
    }

    const policy = resolveAgentModelRouting({
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    })
    applyAgentModelRoutingToEnv(env, policy)

    expect(policy.deepSeekFamily).toBe(false)
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined()
  })

  test('Given DeepSeek 模型 When 应用模型路由 Then 注入 SDK SubAgent 模型环境变量', () => {
    const env: Record<string, string | undefined> = {}

    applyAgentModelRoutingToEnv(env, resolveAgentModelRouting({
      modelId: 'deepseek-v4-flash',
      provider: 'deepseek',
    }))

    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe(DEEPSEEK_SUBAGENT_MODEL_ID)
  })
})
