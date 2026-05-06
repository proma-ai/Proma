import { describe, expect, test } from 'bun:test'
import type { VoiceDictationTranscriptMergeState } from './voice-text-normalizer'
import { mergeVoiceDictationTranscript, normalizeVoiceDictationText } from './voice-text-normalizer'

function emptyState(): VoiceDictationTranscriptMergeState {
  return {
    finalizedText: '',
    partialText: '',
  }
}

describe('normalizeVoiceDictationText', () => {
  test('清理开头停顿词', () => {
    expect(normalizeVoiceDictationText('嗯，让我想想，打开设置页面')).toBe('打开设置页面')
  })
})

describe('mergeVoiceDictationTranscript', () => {
  test('停顿后返回当前分句时保留已确认文本', () => {
    const first = mergeVoiceDictationTranscript(emptyState(), '第一句话。', true)
    const secondPartial = mergeVoiceDictationTranscript(first.state, '第二', false)
    const secondFinal = mergeVoiceDictationTranscript(secondPartial.state, '第二句话。', true)

    expect(secondPartial.text).toBe('第一句话。第二')
    expect(secondFinal.text).toBe('第一句话。第二句话。')
  })

  test('全量返回时不重复拼接文本', () => {
    const first = mergeVoiceDictationTranscript(emptyState(), '第一句话。', true)
    const secondPartial = mergeVoiceDictationTranscript(first.state, '第一句话。第二', false)
    const secondFinal = mergeVoiceDictationTranscript(secondPartial.state, '第一句话。第二句话。', true)

    expect(secondPartial.text).toBe('第一句话。第二')
    expect(secondFinal.text).toBe('第一句话。第二句话。')
  })
})
