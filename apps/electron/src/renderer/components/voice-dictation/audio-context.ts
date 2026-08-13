/**
 * Web Audio 在 macOS 权限弹窗关闭后可能短暂保持 interrupted/suspended。
 * 这不代表麦克风轨道不可用，不能据此中止刚获授权的听写会话。
 */

interface ResumableAudioContext {
  readonly state: AudioContextState
  resume(): Promise<void>
}

/**
 * 尝试恢复音频上下文；只有 resume 本身失败或上下文已关闭时才判定启动失败。
 */
export async function resumeAudioContextForCapture(audioContext: ResumableAudioContext): Promise<void> {
  if (audioContext.state === 'running') return

  try {
    await audioContext.resume()
  } catch {
    throw new Error('音频处理启动失败，请重新触发语音输入或检查系统音频权限')
  }

  if (audioContext.state === 'closed') {
    throw new Error('音频处理已关闭，请重新触发语音输入')
  }
}
