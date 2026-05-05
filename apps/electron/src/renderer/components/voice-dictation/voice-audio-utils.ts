/**
 * 语音输入音频工具
 */

export const TARGET_SAMPLE_RATE = 16000
export const CHUNK_BYTES = TARGET_SAMPLE_RATE * 2 * 0.2

export function floatTo16BitPcm(samples: Float32Array, inputSampleRate: number): ArrayBuffer {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.floor(samples.length / ratio)
  const buffer = new ArrayBuffer(outputLength * 2)
  const view = new DataView(buffer)

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length)
    let sum = 0
    for (let j = start; j < end; j += 1) {
      sum += samples[j] ?? 0
    }
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }

  return buffer
}

export function concatAudioBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const buffer of buffers) {
    output.set(new Uint8Array(buffer), offset)
    offset += buffer.byteLength
  }
  return output.buffer
}

export function splitChunk(buffer: ArrayBuffer, size: number): { chunk: ArrayBuffer | null; rest: ArrayBuffer } {
  if (buffer.byteLength < size) return { chunk: null, rest: buffer }
  return {
    chunk: buffer.slice(0, size),
    rest: buffer.slice(size),
  }
}
