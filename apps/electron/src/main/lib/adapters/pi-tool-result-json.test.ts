import { describe, expect, test } from 'bun:test'
import { normalizePiToolResultDetails, serializePiToolResultPayload } from './pi-tool-result-json'

describe('Pi tool-result JSON normalization', () => {
  test('preserves ordinary JSON and derives transcript text from the same payload', () => {
    expect(serializePiToolResultPayload({ ok: true, count: 1 })).toEqual({
      details: { ok: true, count: 1 },
      text: '{"ok":true,"count":1}',
    })
  })

  test('converts non-JSON primitives deterministically', () => {
    expect(normalizePiToolResultDetails({ id: 42n, missing: undefined, invalid: Number.NaN })).toEqual({
      id: '42',
      missing: null,
      invalid: null,
    })
  })

  test('does not throw when a product tool returns a circular object', () => {
    const payload: { name: string; self?: unknown } = { name: 'result' }
    payload.self = payload

    expect(serializePiToolResultPayload(payload)).toEqual({
      details: { name: 'result', self: '[Circular]' },
      text: '{"name":"result","self":"[Circular]"}',
    })
  })
})
