import { test, expect, describe } from 'bun:test'
import { parseArgs, strFlag, boolFlag, numFlag, parseRange } from './args'

describe('parseArgs', () => {
  test('--key value 形式', () => {
    const { flags, positionals } = parseArgs(['info', 'abc', '--limit', '5'])
    expect(positionals).toEqual(['info', 'abc'])
    expect(flags.limit).toBe('5')
  })

  test('--key=value 形式', () => {
    const { flags } = parseArgs(['--out=cleaned/x.md'])
    expect(flags.out).toBe('cleaned/x.md')
  })

  test('裸 --flag 为 boolean true', () => {
    const { flags } = parseArgs(['export', 'id', '--stdout'])
    expect(flags.stdout).toBe(true)
  })

  test('--flag 后跟另一个 --flag 时前者为 boolean', () => {
    const { flags } = parseArgs(['--json', '--limit', '3'])
    expect(flags.json).toBe(true)
    expect(flags.limit).toBe('3')
  })
})

describe('flag 取值辅助', () => {
  const { flags } = parseArgs(['--limit', '10', '--json', '--name', 'x'])
  test('strFlag', () => expect(strFlag(flags, 'name')).toBe('x'))
  test('strFlag 对 boolean 返回 undefined', () => expect(strFlag(flags, 'json')).toBeUndefined())
  test('boolFlag', () => expect(boolFlag(flags, 'json')).toBe(true))
  test('numFlag', () => expect(numFlag(flags, 'limit')).toBe(10))
  test('numFlag 非数字返回 undefined', () => expect(numFlag(flags, 'name')).toBeUndefined())
})

describe('parseRange', () => {
  test('A-B 闭区间', () => expect(parseRange('3-7')).toEqual([3, 7]))
  test('单数字视为 [N,N]', () => expect(parseRange('5')).toEqual([5, 5]))
  test('非法返回 undefined', () => {
    expect(parseRange('a-b')).toBeUndefined()
    expect(parseRange(undefined)).toBeUndefined()
  })
})
