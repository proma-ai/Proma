import { describe, expect, test } from 'bun:test'
import { mergeVoiceDictationTranscript } from './voice-transcript-merge'

const emptyState = {
  committedText: '',
  currentSessionText: '',
  currentSessionId: '',
}

describe('mergeVoiceDictationTranscript', () => {
  test('replaces interim text from the same ASR session instead of appending it', () => {
    const interim = mergeVoiceDictationTranscript(emptyState, '我们明天', false, 'session-a')
    const corrected = mergeVoiceDictationTranscript(interim.state, '我们明天开会', false, 'session-a')

    expect(interim.text).toBe('我们明天')
    expect(corrected.text).toBe('我们明天开会')
  })

  test('keeps finalized text when ASR reconnects with a new session', () => {
    const first = mergeVoiceDictationTranscript(emptyState, '先记录这一句', true, 'session-a')
    const reconnected = mergeVoiceDictationTranscript(first.state, '再记录这一句', false, 'session-b')

    expect(reconnected.text).toBe('先记录这一句再记录这一句')
    expect(reconnected.state.committedText).toBe('先记录这一句')
  })

  test('inserts a separator when reconnecting English words', () => {
    const first = mergeVoiceDictationTranscript(emptyState, 'Proma', true, 'session-a')
    const reconnected = mergeVoiceDictationTranscript(first.state, 'Agent', false, 'session-b')

    expect(reconnected.text).toBe('Proma Agent')
  })
})
