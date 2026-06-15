import { describe, it, expect } from 'bun:test'
import {
  BUILTIN_FLOW_COMMANDS,
  getBuiltinFlowCommandBySlug,
  isBuiltinFlowSlug,
  parseFlowMentionMessage,
  isFlowMentionMessage,
  buildFlowPrompt,
} from './flow-commands'

describe('flow-commands', () => {
  describe('BUILTIN_FLOW_COMMANDS', () => {
    it('声明了 deep-research 和 ultracode 两个内置 Flow', () => {
      expect(BUILTIN_FLOW_COMMANDS).toHaveLength(2)
      expect(BUILTIN_FLOW_COMMANDS[0].slug).toBe('deep-research')
      expect(BUILTIN_FLOW_COMMANDS[1].slug).toBe('ultracode')
    })

    it('每个内置 Flow 都有 command 和 sdkCommand', () => {
      for (const cmd of BUILTIN_FLOW_COMMANDS) {
        expect(cmd.command).toBe(`!${cmd.slug}`)
        expect(cmd.sdkCommand).toBe(`/${cmd.slug}`)
        expect(cmd.description).toBeTruthy()
      }
    })
  })

  describe('getBuiltinFlowCommandBySlug', () => {
    it('根据 slug 获取内置 Flow', () => {
      const cmd = getBuiltinFlowCommandBySlug('deep-research')
      expect(cmd).toBeDefined()
      expect(cmd!.command).toBe('!deep-research')
    })

    it('不存在的 slug 返回 undefined', () => {
      expect(getBuiltinFlowCommandBySlug('not-found')).toBeUndefined()
    })
  })

  describe('isBuiltinFlowSlug', () => {
    it('内置 Flow slug 返回 true', () => {
      expect(isBuiltinFlowSlug('deep-research')).toBe(true)
      expect(isBuiltinFlowSlug('ultracode')).toBe(true)
    })

    it('非内置 Flow slug 返回 false', () => {
      expect(isBuiltinFlowSlug('custom-flow')).toBe(false)
    })
  })

  describe('parseFlowMentionMessage', () => {
    it('解析 !flow:deep-research', () => {
      const result = parseFlowMentionMessage('!flow:deep-research AI 趋势')
      expect(result).not.toBeNull()
      expect(result!.mention).toBe('!flow:deep-research')
      expect(result!.slug).toBe('deep-research')
      expect(result!.isBuiltin).toBe(true)
      expect(result!.builtinCommand).toBeDefined()
    })

    it('解析 !flow:ultracode', () => {
      const result = parseFlowMentionMessage('!flow:ultracode')
      expect(result).not.toBeNull()
      expect(result!.slug).toBe('ultracode')
      expect(result!.isBuiltin).toBe(true)
    })

    it('解析自定义 Flow mention', () => {
      const result = parseFlowMentionMessage('!flow:my-research-flow 分析报告')
      expect(result).not.toBeNull()
      expect(result!.slug).toBe('my-research-flow')
      expect(result!.isBuiltin).toBe(false)
      expect(result!.builtinCommand).toBeUndefined()
    })

    it('消息中间出现 !flow:mention 不匹配', () => {
      expect(parseFlowMentionMessage('请运行 !flow:deep-research')).toBeNull()
    })

    it('前导空格后可匹配', () => {
      const result = parseFlowMentionMessage('  !flow:deep-research')
      expect(result).not.toBeNull()
      expect(result!.slug).toBe('deep-research')
    })

    it('!ultracode 不带 flow: 前缀不匹配', () => {
      expect(parseFlowMentionMessage('!ultracode')).toBeNull()
    })

    it('!deep-research 不带 flow: 前缀不匹配', () => {
      expect(parseFlowMentionMessage('!deep-research AI 趋势')).toBeNull()
    })

    it('Markdown 图片语法 ![ 不匹配', () => {
      expect(parseFlowMentionMessage('![alt](url)')).toBeNull()
    })

    it('普通文本不匹配', () => {
      expect(parseFlowMentionMessage('hello world')).toBeNull()
    })

    it('只有 ! 不匹配', () => {
      expect(parseFlowMentionMessage('!')).toBeNull()
    })
  })

  describe('isFlowMentionMessage', () => {
    it('Flow mention 消息返回 true', () => {
      expect(isFlowMentionMessage('!flow:deep-research AI 趋势')).toBe(true)
    })

    it('不带 flow: 前缀返回 false', () => {
      expect(isFlowMentionMessage('!deep-research AI 趋势')).toBe(false)
    })

    it('非 Flow mention 消息返回 false', () => {
      expect(isFlowMentionMessage('hello world')).toBe(false)
    })

    it('Markdown 图片语法返回 false', () => {
      expect(isFlowMentionMessage('![image](url)')).toBe(false)
    })
  })

  describe('buildFlowPrompt', () => {
    it('deep-research 透传 /deep-research', () => {
      expect(buildFlowPrompt('!flow:deep-research AI 趋势')).toBe('/deep-research AI 趋势')
    })

    it('deep-research 无参数时只输出斜杠命令', () => {
      expect(buildFlowPrompt('!flow:deep-research')).toBe('/deep-research')
    })

    it('ultracode 转换为 ultracode: 关键字', () => {
      expect(buildFlowPrompt('!flow:ultracode 写一个hello world')).toBe('ultracode: 写一个hello world')
    })

    it('ultracode 无参数时给出引导提示', () => {
      expect(buildFlowPrompt('!flow:ultracode')).toBe('ultracode: Ask me what task should be turned into a dynamic workflow, then write and run that workflow after I answer.')
    })

    it('自定义 Flow 注入 scriptPath', () => {
      expect(buildFlowPrompt('!flow:my-flow 分析报告', { scriptPath: '/path/to/flow.js' }))
        .toBe('/workflow "/path/to/flow.js" 分析报告')
    })

    it('自定义 Flow 无参数时只输出 /workflow + scriptPath', () => {
      expect(buildFlowPrompt('!flow:my-flow', { scriptPath: '/path/to/flow.js' }))
        .toBe('/workflow "/path/to/flow.js"')
    })

    it('自定义 Flow 无 scriptPath 时保留原始消息', () => {
      expect(buildFlowPrompt('!flow:my-flow 分析报告')).toBe('!flow:my-flow 分析报告')
    })

    it('非 Flow mention 保留原始消息', () => {
      expect(buildFlowPrompt('hello world')).toBe('hello world')
    })

    it('scriptPath 含空格时正确加引号', () => {
      expect(buildFlowPrompt('!flow:my-flow', { scriptPath: 'C:\\Users\\User Name\\.proma\\flows\\my-flow\\flow.js' }))
        .toBe('/workflow "C:\\Users\\User Name\\.proma\\flows\\my-flow\\flow.js"')
    })
  })
})
