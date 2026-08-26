import type { TerminalOutputEvent } from '@proma/shared'

export interface TerminalOutputBuffer {
  output: string
  sequence: number
}

/** 保留可重放的末尾输出；序列号始终对应最后一批已接收数据。 */
export function appendTerminalOutput(
  buffer: TerminalOutputBuffer,
  event: TerminalOutputEvent,
  maxChars: number,
): TerminalOutputBuffer {
  const output = `${buffer.output}${event.data}`
  return {
    output: output.length > maxChars ? output.slice(output.length - maxChars) : output,
    sequence: event.sequence,
  }
}
