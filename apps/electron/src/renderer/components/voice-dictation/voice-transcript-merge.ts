/**
 * 语音输入转写文本合并
 *
 * 处理豆包 ASR 返回的增量/全量文本，维护已确认与临时文本的状态。
 */

const ASCII_WORD_EDGE_PATTERN = /[A-Za-z0-9]/

export interface VoiceDictationTranscriptMergeState {
  /** 来自已结束 session 的锁定文本 */
  committedText: string
  /** 当前活跃 session 的最新文本 */
  currentSessionText: string
  /** 当前活跃 session 的 ID */
  currentSessionId: string
}

export interface VoiceDictationTranscriptMergeResult {
  state: VoiceDictationTranscriptMergeState
  text: string
}

function joinTranscriptParts(left: string, right: string): string {
  if (!left) return right
  if (!right) return left

  const lastLeft = left.at(-1) ?? ''
  const firstRight = right.at(0) ?? ''
  const separator = ASCII_WORD_EDGE_PATTERN.test(lastLeft) && ASCII_WORD_EDGE_PATTERN.test(firstRight)
    ? ' '
    : ''
  return `${left}${separator}${right}`
}

/**
 * 合成豆包 ASR 返回的文本。
 *
 * 核心设计：同一 session 内服务端返回 full result（完整累积文本），直接替换即可。
 * 跨 session（重连后）的文本通过 committedText 拼接保留。
 */
export function mergeVoiceDictationTranscript(
  state: VoiceDictationTranscriptMergeState,
  incomingText: string,
  isFinal: boolean,
  sessionId: string,
): VoiceDictationTranscriptMergeResult {
  const text = incomingText.trim()
  if (!text) {
    return {
      state,
      text: joinTranscriptParts(state.committedText, state.currentSessionText),
    }
  }

  // 同一 session：服务端 result_type=full，直接用最新文本替换
  if (sessionId === state.currentSessionId) {
    const newState: VoiceDictationTranscriptMergeState = {
      committedText: state.committedText,
      currentSessionText: text,
      currentSessionId: sessionId,
    }
    return {
      state: newState,
      text: joinTranscriptParts(state.committedText, text),
    }
  }

  // 新 session（首次或重连后）：把之前的文本锁定到 committedText
  const prevFull = joinTranscriptParts(state.committedText, state.currentSessionText)
  const newState: VoiceDictationTranscriptMergeState = {
    committedText: prevFull,
    currentSessionText: text,
    currentSessionId: sessionId,
  }
  return {
    state: newState,
    text: joinTranscriptParts(prevFull, text),
  }
}
