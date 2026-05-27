import { describe, expect, test } from 'bun:test'
import type { FeishuBotConfig } from '@proma/shared'
import {
  buildSessionMirrorGroupName,
  normalizeFeishuSessionMirrorSettings,
  resolveSessionMirrorBot,
} from './session-mirror'

const enabledBot: FeishuBotConfig = {
  id: 'bot-enabled',
  name: '研发助手',
  enabled: true,
  appId: 'cli_enabled',
  appSecret: 'encrypted',
}

const disabledBot: FeishuBotConfig = {
  id: 'bot-disabled',
  name: '归档助手',
  enabled: false,
  appId: 'cli_disabled',
  appSecret: 'encrypted',
}

describe('飞书 Session 镜像设置', () => {
  test('Given 未配置镜像 When 读取设置 Then 默认关闭', () => {
    expect(normalizeFeishuSessionMirrorSettings(undefined)).toEqual({ mode: 'off' })
  })

  test('Given 旧版通知配置 When 读取设置 Then 归一化为关闭', () => {
    expect(normalizeFeishuSessionMirrorSettings({
      mode: 'completion',
      botId: enabledBot.id,
    } as unknown as Parameters<typeof normalizeFeishuSessionMirrorSettings>[0])).toEqual({ mode: 'off' })
  })

  test('Given 多个 Bot When 实时同步指定一个 Bot Then 只选择该 Bot', () => {
    const bot = resolveSessionMirrorBot(
      { mode: 'stream', botId: enabledBot.id },
      [disabledBot, enabledBot],
    )

    expect(bot?.id).toBe(enabledBot.id)
  })

  test('Given 指定 Bot 未启用 When 解析同步 Bot Then 不创建镜像', () => {
    const bot = resolveSessionMirrorBot(
      { mode: 'stream', botId: disabledBot.id },
      [disabledBot, enabledBot],
    )

    expect(bot).toBeNull()
  })

  test('Given 新 Agent 会话 When 构造群名 Then 使用短 ID 避免空泛标题', () => {
    expect(buildSessionMirrorGroupName({
      id: '1234567890abcdef',
      title: '新 Agent 会话',
    })).toBe('Proma - 新会话 12345678')
  })
})
