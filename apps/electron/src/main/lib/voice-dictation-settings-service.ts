/**
 * 语音输入设置服务
 *
 * 独立处理豆包 ASR 凭证，避免通过通用 settings IPC 暴露加密细节。
 */

import { safeStorage } from 'electron'
import { isCloudMode } from '@proma/cloud'
import type { VoiceDictationSettings, VoiceDictationSettingsUpdate } from '../../types'
import { getSettings, updateSettings } from './settings-service'

const DEFAULT_VOICE_DICTATION_SETTINGS: VoiceDictationSettings = {
  enabled: false,
  provider: 'doubao',
  cloudMode: false,
  useCloud: false,
  appId: '',
  accessToken: '',
  resourceId: 'volc.seedasr.sauc.duration',
  language: '',
  endpointMode: 'async',
  outputMode: 'auto',
}

function encryptSecret(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[语音输入] safeStorage 加密不可用，将以明文存储 Access Token')
    return value
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decryptSecret(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch (error) {
    console.error('[语音输入] 解密 Access Token 失败:', error)
    return ''
  }
}

/** 获取解密后的语音输入设置 */
export function getVoiceDictationSettings(): VoiceDictationSettings {
  const raw = getSettings().voiceDictation ?? {}
  const encryptedAccessToken = raw.accessToken ?? raw.accessKey ?? ''
  const cloudMode = isCloudMode()
  return {
    ...DEFAULT_VOICE_DICTATION_SETTINGS,
    ...raw,
    cloudMode,
    useCloud: cloudMode ? raw.useCloud ?? true : false,
    appId: raw.appId ?? raw.appKey ?? '',
    accessToken: decryptSecret(encryptedAccessToken),
  }
}

/** 保存语音输入设置，Access Token 加密后落盘 */
export function updateVoiceDictationSettings(
  updates: VoiceDictationSettingsUpdate,
): VoiceDictationSettings {
  const current = getVoiceDictationSettings()
  const cloudMode = isCloudMode()
  const next: VoiceDictationSettings = {
    ...current,
    ...updates,
    provider: 'doubao',
    cloudMode,
    useCloud: cloudMode ? updates.useCloud ?? current.useCloud : false,
  }

  updateSettings({
    voiceDictation: {
      ...next,
      accessToken: encryptSecret(next.accessToken),
    },
  })

  return next
}
