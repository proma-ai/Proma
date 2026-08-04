/**
 * 文本输出服务
 *
 * 语音输入完成后优先写入 Proma 输入框，否则尝试写入当前光标位置。
 */

import { BrowserWindow, clipboard } from 'electron'
import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import type {
  VoiceDictationCommitInput,
  VoiceDictationCommitResult,
  VoiceDictationOutputContext,
  VoiceDictationPreviewInput,
  VoiceDictationSettings,
  VoiceDictationTextEvent,
} from '../../types'
import { getMainWindow } from '../index'
import { pasteTextAtCurrentCursor } from './text-insertion-service'
import { VoiceDictationOutputContextStore } from './voice-dictation-output-context'
import { VoiceDictationTextDeliveryTracker } from './voice-dictation-text-delivery'

let targetWasPromaInput = false
let activePreviewSessionId: string | null = null
let closedPreviewSessionId: string | null = null
const voiceDictationOutputContexts = new VoiceDictationOutputContextStore()
const voiceDictationTextDeliveries = new VoiceDictationTextDeliveryTracker()
const TEXT_DELIVERY_ACK_TIMEOUT_MS = 750

/** 在显示语音浮窗前记录目标是否为 Proma 主窗口。 */
export function captureVoiceDictationTarget(forcePromaInput?: boolean): boolean {
  const mainWindow = getMainWindow()
  targetWasPromaInput = forcePromaInput ?? BrowserWindow.getFocusedWindow() === mainWindow
  return targetWasPromaInput
}

/** 在主进程创建本次听写的冻结输出上下文。 */
export function beginVoiceDictationOutputContext(
  contextId: string,
  context: VoiceDictationOutputContext,
): void {
  voiceDictationOutputContexts.begin(contextId, context)
}

/** 释放已完成、取消或隐藏的听写会话输出上下文。 */
export function releaseVoiceDictationOutputContext(contextId?: string): void {
  voiceDictationOutputContexts.release(contextId)
}

function shouldWriteToPromaInput(settings: VoiceDictationSettings): boolean {
  return settings.outputMode === 'proma-input' ||
    (settings.outputMode === 'auto' && targetWasPromaInput)
}

function resolveVoiceDictationOutputContext(
  outputContextId: string | undefined,
  settings: VoiceDictationSettings,
): VoiceDictationOutputContext | undefined {
  if (outputContextId !== undefined) return voiceDictationOutputContexts.get(outputContextId)

  // 兼容尚未携带输出上下文 ID 的旧渲染进程。
  return {
    routeToPromaInput: shouldWriteToPromaInput(settings),
    outputMode: settings.outputMode,
  }
}

function sendTextEvent(channel: string, event: VoiceDictationTextEvent): boolean {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send(channel, event)
  return true
}

function sendTextEventAndAwaitDelivery(event: VoiceDictationTextEvent): Promise<boolean> {
  const delivery = voiceDictationTextDeliveries.waitFor(event.sessionId, TEXT_DELIVERY_ACK_TIMEOUT_MS)
  if (!sendTextEvent(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, event)) {
    voiceDictationTextDeliveries.acknowledge(event.sessionId, false)
  }
  return delivery
}

/** Receives the renderer's confirmation that the frozen input target consumed final text. */
export function acknowledgeVoiceDictationTextDelivery(sessionId: string, delivered: boolean): void {
  voiceDictationTextDeliveries.acknowledge(sessionId, delivered)
}

/**
 * 将 ASR 的最新完整结果预览到 Proma 输入框。
 * 外部应用只在结束时一次性写入，避免连续粘贴打断用户输入。
 */
export function previewVoiceDictationText(
  input: VoiceDictationPreviewInput,
  settings: VoiceDictationSettings,
): void {
  const text = input.text.trim()
  const outputContext = resolveVoiceDictationOutputContext(input.outputContextId, settings)
  if (!text || !outputContext?.routeToPromaInput) return
  if (input.sessionId === closedPreviewSessionId) return
  if (activePreviewSessionId && activePreviewSessionId !== input.sessionId) return
  activePreviewSessionId = input.sessionId
  sendTextEvent(VOICE_DICTATION_IPC_CHANNELS.PREVIEW_TEXT, {
    sessionId: input.sessionId,
    text,
    targetInputId: input.targetInputId,
  })
}

/** 取消录音时撤销尚未提交到 Proma 输入框的临时组合文本。 */
export function clearVoiceDictationPreview(
  sessionId: string,
  targetInputId?: string | null,
  outputContextId?: string,
): void {
  if (activePreviewSessionId === sessionId) {
    activePreviewSessionId = null
    sendTextEvent(VOICE_DICTATION_IPC_CHANNELS.CLEAR_PREVIEW_TEXT, { sessionId, text: '', targetInputId })
  }
  closedPreviewSessionId = sessionId
  acknowledgeVoiceDictationTextDelivery(sessionId, false)
  releaseVoiceDictationOutputContext(outputContextId)
}

export async function commitVoiceDictationText(
  input: VoiceDictationCommitInput,
  settings: VoiceDictationSettings,
): Promise<VoiceDictationCommitResult> {
  const outputContext = resolveVoiceDictationOutputContext(input.outputContextId, settings)

  try {
    if (!outputContext) {
      return { mode: 'clipboard', success: false, message: '听写会话已结束，未输出文本' }
    }

    const trimmed = input.text.trim()
    if (!trimmed) {
      return { mode: 'clipboard', success: false, message: '没有可输出的语音文本' }
    }

    const hasActivePreview = activePreviewSessionId === input.sessionId
    const shouldSendToPromaInput = hasActivePreview || outputContext.routeToPromaInput
    if (shouldSendToPromaInput) {
      const delivered = await sendTextEventAndAwaitDelivery({
        sessionId: input.sessionId,
        text: trimmed,
        targetInputId: input.targetInputId,
      })
      activePreviewSessionId = null
      closedPreviewSessionId = input.sessionId
      if (input.outputContextId && !voiceDictationOutputContexts.get(input.outputContextId)) {
        return { mode: 'clipboard', success: false, message: '听写会话已取消，未输出文本' }
      }
      if (delivered) {
        return { mode: 'proma-input', success: true, message: '已写入 Proma 输入框' }
      }

      clipboard.writeText(trimmed)
      return { mode: 'clipboard', success: true, message: 'Proma 输入框未确认接收，已复制到剪贴板' }
    }

    if (outputContext.outputMode === 'auto') {
      const result = await pasteTextAtCurrentCursor(trimmed)
      return result.success
        ? { mode: 'cursor', success: true, message: result.message }
        : { mode: 'clipboard', success: true, message: result.message }
    }

    clipboard.writeText(trimmed)
    return { mode: 'clipboard', success: true, message: '已复制到剪贴板' }
  } finally {
    releaseVoiceDictationOutputContext(input.outputContextId)
  }
}
