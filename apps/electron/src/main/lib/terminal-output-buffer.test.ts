import { describe, expect, test } from 'bun:test'
import { appendTerminalOutput, readTerminalOutput } from './terminal-output-buffer'

describe('terminal output buffer', () => {
  test('does not retain a partial ANSI sequence at a truncated boundary', () => {
    const buffer = appendTerminalOutput(
      { output: '', sequence: 0, startOffset: 0, endOffset: 0 },
      { terminalId: 'terminal-1', sequence: 1, data: '\u001B[31mred\u001B[0m\rprogress\n' },
      12,
    )

    const result = readTerminalOutput(buffer, { offset: 0, limit: 12 })

    expect(buffer.startOffset).toBe(12)
    expect(result.output).toBe('progress\n')
    expect(result.truncatedBefore).toBe(true)
    expect(result.truncatedAfter).toBe(false)
  })

  test('removes zsh repaint controls without inventing extra output lines', () => {
    const buffer = appendTerminalOutput(
      { output: '', sequence: 0, startOffset: 0, endOffset: 0 },
      {
        terminalId: 'terminal-1',
        sequence: 1,
        data: '\u001BP$q q\u001B\\\u001B[?1h\u001B=\rprompt\u001B[?1l\u001B>\rdone\r\n',
      },
      256,
    )

    expect(readTerminalOutput(buffer).output).toBe('promptdone\n')
  })

  test('keeps a bounded page and exposes its next offset', () => {
    const buffer = appendTerminalOutput(
      { output: '', sequence: 0, startOffset: 0, endOffset: 0 },
      { terminalId: 'terminal-1', sequence: 1, data: 'abcdefgh' },
      8,
    )

    const result = readTerminalOutput(buffer, { offset: 2, limit: 3 })

    expect(result.output).toBe('cde')
    expect(result.nextOffset).toBe(5)
    expect(result.truncatedBefore).toBe(true)
    expect(result.truncatedAfter).toBe(true)
  })
})
