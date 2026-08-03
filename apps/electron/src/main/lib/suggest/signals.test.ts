import { describe, expect, test } from 'bun:test'
import {
  extractSignals,
  normalizeRule,
  hasStrongSignal,
  CORRECTION_PATTERNS,
  FOLLOWUP_PATTERNS,
  AUTOMATION_PATTERNS,
  TODO_PATTERNS,
} from './signals'

describe('suggest/signals: 纠正信号', () => {
  test('识别明确纠正 "以后不要 X"', () => {
    const signals = extractSignals(['以后不要用 setTimeout 写定时器'])
    const correction = signals.find((s) => s.kind === 'correction')
    expect(correction).toBeDefined()
    if (correction && correction.kind === 'correction') {
      expect(correction.confidence).toBeGreaterThan(0.9)
    }
  })

  test('识别 "下次记得 X"', () => {
    const signals = extractSignals(['下次记得先查文档'])
    expect(signals.some((s) => s.kind === 'correction')).toBe(true)
  })

  test('识别 "我更喜欢 X"', () => {
    const signals = extractSignals(['我更喜欢用 TypeScript 而不是 JavaScript'])
    expect(signals.some((s) => s.kind === 'correction')).toBe(true)
  })

  test('过长文本不误报（纯描述无纠正词）', () => {
    const signals = extractSignals(['帮我写一个排序算法，要求稳定排序'])
    expect(signals.some((s) => s.kind === 'correction')).toBe(false)
  })

  test('明确拒绝时不触发纠正建议', () => {
    const signals = extractSignals(['不用了，就到这吧'])
    expect(signals.length).toBe(0)
  })
})

describe('suggest/signals: 跟进与定时信号', () => {
  test('识别 "明天继续"', () => {
    const signals = extractSignals(['明天继续这个任务'])
    expect(signals.some((s) => s.kind === 'followup')).toBe(true)
  })

  test('识别 "稍后提醒我"', () => {
    const signals = extractSignals(['稍后提醒我提交代码'])
    expect(signals.some((s) => s.kind === 'followup')).toBe(true)
  })

  test('识别周期性需求 "每天自动总结"', () => {
    const signals = extractSignals(['每天自动帮我总结当天工作'])
    expect(signals.some((s) => s.kind === 'automation')).toBe(true)
  })

  test('识别未完成信号 "这个功能还没做完"', () => {
    const signals = extractSignals(['这个功能还没做完，回头再弄'])
    expect(signals.some((s) => s.kind === 'todo')).toBe(true)
  })
})

describe('suggest/signals: 重复意图', () => {
  test('同一意图出现 2 次识别为重复', () => {
    const signals = extractSignals(['帮我总结一下今天的工作', '帮我总结一下项目进展'])
    const repeat = signals.find((s) => s.kind === 'repeat')
    expect(repeat).toBeDefined()
    if (repeat && repeat.kind === 'repeat') {
      expect(repeat.count).toBe(2)
    }
  })

  test('不同意图不误判重复', () => {
    const signals = extractSignals(['帮我写个排序', '帮我画个图'])
    expect(signals.some((s) => s.kind === 'repeat')).toBe(false)
  })
})

describe('suggest/signals: 工具函数', () => {
  test('normalizeRule 去除引导词但保留否定词（P0 语义反转修复）', () => {
    // 否定词是规则核心语义，必须保留
    expect(normalizeRule('以后不要用 setTimeout')).toBe('不要用 setTimeout')
    expect(normalizeRule('记住先查文档。')).toBe('先查文档')
  })

  test('normalizeRule 保留否定词（回归："以后不要用 var" 不能变成 "用 var"）', () => {
    expect(normalizeRule('以后不要用 var 声明变量')).toBe('不要用 var 声明变量')
    expect(normalizeRule('下次别再用 var')).toBe('别再用 var')
    expect(normalizeRule('以后不要再写死路径')).toBe('不要再写死路径')
  })

  test('hasStrongSignal 检测强信号', () => {
    expect(hasStrongSignal(['明天继续'])).toBe(true)
    expect(hasStrongSignal(['帮我写个 hello world'])).toBe(false)
  })

  test('模式表非空且为正则', () => {
    expect(CORRECTION_PATTERNS.length).toBeGreaterThan(0)
    expect(FOLLOWUP_PATTERNS.length).toBeGreaterThan(0)
    expect(AUTOMATION_PATTERNS.length).toBeGreaterThan(0)
    expect(TODO_PATTERNS.length).toBeGreaterThan(0)
  })
})

describe('suggest/signals: 子代理审查边界回归', () => {
  test('"以后再说吧" 不误判为纠正（延后≠纠正）', () => {
    const signals = extractSignals(['这个问题以后再说吧'])
    expect(signals.some((s) => s.kind === 'correction')).toBe(false)
  })

  test('"以后" 太短不触发（断片防护）', () => {
    const signals = extractSignals(['以后不要'])
    expect(signals.some((s) => s.kind === 'correction')).toBe(false)
  })

  test('"不要这样" 无意义内容不触发', () => {
    const signals = extractSignals(['不要这样'])
    expect(signals.some((s) => s.kind === 'correction')).toBe(false)
  })

  test('"明天再说吧" 不触发 followup（推迟讨论不是任务）', () => {
    const signals = extractSignals(['明天再说吧'])
    expect(signals.some((s) => s.kind === 'followup')).toBe(false)
  })

  test('含拒绝词但主体是纠正的消息仍提取纠正信号', () => {
    const signals = extractSignals(['不用管那个 bug，以后写代码注意点'])
    expect(signals.some((s) => s.kind === 'correction')).toBe(true)
  })

  test('弱意图 "帮我看看X"+"帮我看看Y" 不误判重复', () => {
    const signals = extractSignals(['帮我看看这个文件', '帮我看看那个配置'])
    expect(signals.some((s) => s.kind === 'repeat')).toBe(false)
  })

  test('"还没" 断片不触发 todo', () => {
    const signals = extractSignals(['还没'])
    expect(signals.some((s) => s.kind === 'todo')).toBe(false)
  })
})
