import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const viewSource = readFileSync(new URL('../../renderer/components/agent/AgentView.tsx', import.meta.url), 'utf-8')
const orchestratorSource = readFileSync(new URL('./agent-orchestrator.ts', import.meta.url), 'utf-8')
const rewindHandler = viewSource.slice(
  viewSource.indexOf('const handleRewindConfirm ='),
  viewSource.indexOf('}, [rewindTargetUuid, sessionId, store])'),
)
const rewindMethod = orchestratorSource.slice(
  orchestratorSource.indexOf('  async rewindSession('),
  orchestratorSource.indexOf('  /** 中止所有活跃的 Agent 会话'),
)

// 静态契约检查用于防止旧文件恢复文案回归；实际对话截断由 agent-session-manager.test.ts 覆盖。
describe('Pi 对话回退提示契约', () => {
  test('Given 当前不支持文件回退 When 展示确认弹窗 Then 只描述对话截断并保留不可撤销提醒', () => {
    expect(viewSource).toContain('回退将截断该消息之后的所有对话。此操作不可撤销，确定要回退吗？')
    expect(viewSource).not.toContain('并恢复文件到该时刻的状态')
  })

  test('Given 对话成功回退 When 返回不支持文件恢复 Then 不将正常能力限制标为错误', () => {
    expect(rewindMethod).toContain('await rewindPiAgentSession(sessionId, assistantMessageUuid)')
    expect(rewindMethod).toMatch(/fileRewind:\s*\{\s*canRewind: false,?\s*\}/)
    expect(rewindMethod).not.toMatch(/error\s*:/)
    expect(rewindHandler).toContain("toast.success('已回退到此处')")
  })

  test('Given 对话回退真的失败 When 捕获异常 Then 仍展示错误且保留运行中与无会话 ID 校验', () => {
    expect(rewindHandler).toContain('catch (error)')
    expect(rewindHandler).toContain("toast.error('回退失败'")
    expect(rewindMethod).toContain("throw new Error('会话正在运行中，请停止后再回退')")
    expect(rewindMethod).toContain("throw new Error('会话没有 Pi session ID，无法回退')")
  })
})
