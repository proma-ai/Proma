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

/** Scratch Pad 编辑器的语音输入目标 ID */
export const SCRATCH_PAD_VOICE_INPUT_ID = '__proma-scratch-pad__'

/** 主进程派发到渲染进程、再由当前焦点编辑器消费的事件名 */
export const VOICE_DICTATION_INSERT_EVENT = 'proma:insert-voice-dictation-text'
