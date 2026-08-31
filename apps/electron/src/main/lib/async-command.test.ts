import { describe, expect, test } from 'bun:test'
import { execFileAsync } from './async-command'

describe('execFileAsync', () => {
  test('异步返回 stdout 和 stderr', async () => {
    const result = await execFileAsync(process.execPath, ['-e', 'process.stdout.write("ok"); process.stderr.write("warn")'])

    expect(result.stdout).toBe('ok')
    expect(result.stderr).toBe('warn')
  })

  test('命令失败时 reject', async () => {
    await expect(execFileAsync(process.execPath, ['-e', 'process.exit(3)'])).rejects.toBeDefined()
  })

  test('支持 Buffer 输出和超时', async () => {
    const result = await execFileAsync(
      process.execPath,
      ['-e', 'process.stdout.write(Buffer.from([0xff, 0xfe]))'],
      { encoding: 'buffer' },
    )

    expect(Buffer.isBuffer(result.stdout)).toBe(true)
    expect(result.stdout).toEqual(Buffer.from([0xff, 0xfe]))
    await expect(
      execFileAsync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeout: 10 }),
    ).rejects.toBeDefined()
  })
})
