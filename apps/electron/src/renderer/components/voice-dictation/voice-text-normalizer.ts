/**
 * 语音输入文本规范化
 *
 * 只做确定性口语清洗，不调用二次模型。
 */

const LEADING_THINKING_PATTERNS: RegExp[] = [
  /^(?:让我想想啊?|我想一下|我想想|等一下|稍等一下)[，,。.\s]*/u,
  /^(?:我刚刚(?:记得|想起来)来着|刚刚想起来了?)[，,。.\s]*/u,
]

const CLAUSE_FILLER_PATTERN = /(^|[，。！？；、,.!?\s])(?:嗯+|呃+|额+|啊+|哎+|诶+|哦+|喔+|那个|这个|就是|然后)[，、,\s]*/gu
const CLAUSE_THINKING_PATTERN = /(^|[，。！？；、,.!?\s])(?:让我想想啊?|我想一下|我想想|等一下|稍等一下|我刚刚(?:记得|想起来)来着|刚刚想起来了?)[，,。.\s]*/gu
const DEMONSTRATIVE_FILLER_PATTERN = /(?:这个|那个)(?=(?:光标|功能|问题|位置|输入|内容|界面|窗口|按钮|文字|文本|地方|时候|模式|配置|逻辑|体验|过程|设置|边框))/gu
const SENTENCE_PUNCTUATION_PATTERN = /[，。！？；、,.!?;\s]/gu
const ASCII_WORD_EDGE_PATTERN = /[A-Za-z0-9]/

export interface VoiceDictationTranscriptMergeState {
  finalizedText: string
  partialText: string
}

export interface VoiceDictationTranscriptMergeResult {
  state: VoiceDictationTranscriptMergeState
  text: string
}

function collapseRepeatedPronouns(text: string): string {
  return text.replace(/(这个|那个|我|你|他|她|它|这|那)\1/gu, '$1')
}

function collapseAccidentalRepeats(text: string): string {
  return text
    .replace(/([我你他她它这那给还有是的了就不在要会能把被和跟再也都来去可])\1+/gu, '$1')
    .replace(/做做(?=[的了得过出成到])/gu, '做')
    .replace(/想{3,}/gu, '想想')
}

function normalizePunctuation(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。！？；、,.!?])\s*/g, '$1')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。．.]{2,}/g, '。')
    .replace(/[！？!?]{2,}/g, (match) => match.includes('？') || match.includes('?') ? '？' : '！')
    .replace(/^[，。！？；、,.!?\s]+/u, '')
    .trim()
}

/** 清理常见口语停顿词和犹豫表达，保留原始语义。 */
export function normalizeVoiceDictationText(text: string): string {
  let normalized = text.trim()
  if (!normalized) return ''

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of LEADING_THINKING_PATTERNS) {
      const next = normalized.replace(pattern, '')
      if (next !== normalized) {
        normalized = next
        changed = true
      }
    }
  }

  normalized = normalized.replace(CLAUSE_FILLER_PATTERN, '$1')
  normalized = normalized.replace(CLAUSE_THINKING_PATTERN, '$1')
  normalized = collapseRepeatedPronouns(normalized)
  normalized = collapseAccidentalRepeats(normalized)
  normalized = normalized.replace(DEMONSTRATIVE_FILLER_PATTERN, '')
  return normalizePunctuation(normalized)
}

function getComparableText(text: string): string {
  return text.replace(SENTENCE_PUNCTUATION_PATTERN, '')
}

function isFullTranscriptUpdate(incomingText: string, finalizedText: string): boolean {
  if (!finalizedText) return true
  if (incomingText.startsWith(finalizedText)) return true

  const incomingComparable = getComparableText(incomingText)
  const finalizedComparable = getComparableText(finalizedText)
  return incomingComparable.startsWith(finalizedComparable)
}

function stripFinalizedPrefix(incomingText: string, finalizedText: string): string {
  if (!finalizedText) return incomingText
  if (incomingText.startsWith(finalizedText)) {
    return incomingText.slice(finalizedText.length).trimStart()
  }
  return incomingText
}

function joinTranscriptParts(finalizedText: string, segmentText: string): string {
  if (!finalizedText) return segmentText
  if (!segmentText) return finalizedText

  const lastFinalized = finalizedText.at(-1) ?? ''
  const firstSegment = segmentText.at(0) ?? ''
  const separator = ASCII_WORD_EDGE_PATTERN.test(lastFinalized) && ASCII_WORD_EDGE_PATTERN.test(firstSegment)
    ? ' '
    : ''
  return `${finalizedText}${separator}${segmentText}`
}

/**
 * 合成豆包 ASR 返回的文本。
 *
 * 豆包在 VAD 判停后可能返回“全量文本”，也可能返回“当前分句”。
 * 浮窗需要保留已确认分句，并用最新 partial 替换当前分句，避免停顿后覆盖前文。
 */
export function mergeVoiceDictationTranscript(
  state: VoiceDictationTranscriptMergeState,
  incomingText: string,
  isFinal: boolean,
): VoiceDictationTranscriptMergeResult {
  const text = incomingText.trim()
  if (!text) {
    return {
      state,
      text: joinTranscriptParts(state.finalizedText, state.partialText),
    }
  }

  if (!state.finalizedText) {
    return {
      state: {
        finalizedText: isFinal ? text : '',
        partialText: isFinal ? '' : text,
      },
      text,
    }
  }

  if (isFullTranscriptUpdate(text, state.finalizedText)) {
    return {
      state: {
        finalizedText: isFinal ? text : state.finalizedText,
        partialText: isFinal ? '' : stripFinalizedPrefix(text, state.finalizedText),
      },
      text,
    }
  }

  const mergedText = joinTranscriptParts(state.finalizedText, text)
  return {
    state: {
      finalizedText: isFinal ? mergedText : state.finalizedText,
      partialText: isFinal ? '' : text,
    },
    text: mergedText,
  }
}
