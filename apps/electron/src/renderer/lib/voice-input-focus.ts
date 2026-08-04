/**
 * 语音输入焦点路由
 *
 * 用于将"豆包流式语音输入"识别得到的文本回填到正确的目标输入框（RichTextInput / ScratchPad / 未来其他编辑器）。
 *
 * 思路：每个可接收语音输入的编辑器在获得焦点时注册自己的 ID，主进程派发 CustomEvent 时，
 * 由各编辑器自行判断"上次聚焦的目标 ID 是否是自己"，是则消费事件并 preventDefault。
 *
 * 为什么不用 document.activeElement：用户点击语音按钮 / 触发快捷键时编辑器会失焦，
 * 等识别完成回填时已经不再聚焦在编辑器上。
 */

let lastFocusedVoiceInputId: string | null = null

export function setLastFocusedVoiceInputId(id: string | null): void {
  lastFocusedVoiceInputId = id
}

export function getLastFocusedVoiceInputId(): string | null {
  return lastFocusedVoiceInputId
}

/**
 * 在听写会话开始时冻结状态归属和文本回填目标。
 *
 * 按钮来源始终用于显示录音状态；只有本次输出应写回 Proma 时，它才同时成为文本目标。
 * 这样“复制到剪贴板”模式仍会在发起按钮上显示录音状态，却不会向编辑器派发预览或最终文本。
 */
export function resolveVoiceDictationSessionInputIds(
  routeToPromaInput: boolean,
  sourceInputId?: string,
): { sourceInputId: string | null; targetInputId: string | null } {
  const targetInputId = routeToPromaInput
    ? sourceInputId ?? lastFocusedVoiceInputId
    : null

  return {
    sourceInputId: sourceInputId ?? targetInputId,
    targetInputId,
  }
}

/**
 * 只有旧事件未提供目标，或本次会话明确选择全局回退时，才可写入当前活动 Tab。
 * 显式字符串目标失效（例如原输入框已卸载）时必须丢弃，不能误写到其他会话。
 */
export function shouldFallbackVoiceDictationToActiveTab(
  targetInputId: string | null | undefined,
): boolean {
  return targetInputId === null || targetInputId === undefined
}

/**
 * 判断一条听写事件是否属于指定输入框。
 *
 * 新事件带有会话开始时冻结的 targetInputId，必须优先使用它，避免录音期间焦点变化导致文本写入别处。
 * 仅兼容旧事件省略该字段的情况才回退到最后聚焦的输入框；显式 null 表示不要路由到任何内部输入框。
 */
export function isVoiceDictationTargetInput(
  inputId: string,
  targetInputId: string | null | undefined,
): boolean {
  const resolvedTargetInputId = targetInputId === undefined
    ? lastFocusedVoiceInputId
    : targetInputId
  return resolvedTargetInputId === inputId
}

/** Scratch Pad 编辑器的语音输入目标 ID */
export const SCRATCH_PAD_VOICE_INPUT_ID = '__proma-scratch-pad__'

/** 主进程派发到渲染进程、再由当前焦点编辑器消费的事件名 */
export const VOICE_DICTATION_INSERT_EVENT = 'proma:insert-voice-dictation-text'

/** 语音识别过程中的组合文本预览事件。 */
export const VOICE_DICTATION_PREVIEW_EVENT = 'proma:preview-voice-dictation-text'

/** 取消语音输入时撤销组合文本预览。 */
export const VOICE_DICTATION_CLEAR_PREVIEW_EVENT = 'proma:clear-voice-dictation-preview'

/** 底部输入工具栏显示的语音状态。 */
export const VOICE_DICTATION_STATUS_EVENT = 'proma:voice-dictation-status'
