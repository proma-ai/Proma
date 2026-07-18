import { describe, expect, test } from 'bun:test'
import { createPartialMessageCoalescer } from './pi-streaming-control'

describe('Pi partial message coalescer', () => {
  test('flushes only the newest partial message and stops after dispose', () => {
    const emitted: string[] = []
    const coalescer = createPartialMessageCoalescer((value: string) => emitted.push(value), 50)

    coalescer.schedule('first')
    coalescer.schedule('latest')
    coalescer.flush()
    expect(emitted).toEqual(['latest'])

    coalescer.schedule('discarded')
    coalescer.dispose()
    coalescer.flush()
    expect(emitted).toEqual(['latest'])
  })
})
