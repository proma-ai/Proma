import { describe, expect, test } from 'bun:test'
import {
  isVoiceDictationPreviewRangeCurrent,
  type VoiceDictationPreviewRange,
} from './voice-dictation-preview'

const preview: VoiceDictationPreviewRange = {
  sessionId: 'session-1',
  from: 4,
  to: 9,
  text: '语音预览',
}

describe('isVoiceDictationPreviewRangeCurrent', () => {
  test('accepts an unchanged preview range', () => {
    expect(isVoiceDictationPreviewRangeCurrent(preview, () => '语音预览')).toBe(true)
  })

  test('rejects a range edited inside the preview', () => {
    expect(isVoiceDictationPreviewRangeCurrent(preview, () => '语音手动预览')).toBe(false)
  })
})
