import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { mergeOverlappingMessageSnapshots } from './message-group-rendering'

function message(key: string): SDKMessage {
  return { type: 'assistant', uuid: key, message: { content: [] } } as unknown as SDKMessage
}

function merge(persisted: string[], live: string[]): string[] {
  return mergeOverlappingMessageSnapshots(
    persisted.map(message),
    live.map(message),
    (item) => (item as { uuid: string }).uuid,
  ).map((item) => (item as { uuid: string }).uuid)
}

describe('mergeOverlappingMessageSnapshots', () => {
  test('replaces a persisted suffix when live starts with the same snapshot', () => {
    expect(merge(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  test('replaces a persisted suffix when live only keeps the latest tail', () => {
    expect(merge(['a', 'b'], ['c', 'b'])).toEqual(['a', 'b'])
  })

  test('preserves both snapshots when there is no boundary overlap', () => {
    expect(merge(['a', 'b'], ['c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
  })

  test('keeps the full overlap when the live prefix exactly matches the persisted suffix', () => {
    expect(merge(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
  })
})
