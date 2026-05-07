/**
 * 麦克风权限服务
 *
 * 平台差异处理：
 * - macOS: 使用 systemPreferences API 检查和请求麦克风权限
 * - Windows: Electron 不支持麦克风权限检查，由渲染进程 getUserMedia 触发系统弹窗
 */

import { systemPreferences } from 'electron'
import type { MicPermissionResult } from '../../types'

function getPlatform(): NodeJS.Platform {
  return process.platform
}

export function checkMicrophonePermission(): MicPermissionResult {
  const platform = getPlatform()

  if (platform === 'darwin') {
    const raw = systemPreferences.getMediaAccessStatus('microphone')
    // Electron 返回: 'granted' | 'denied' | 'not-determined' | 'restricted'
    let status: MicPermissionResult['status']
    if (raw === 'granted' || raw === 'denied' || raw === 'not-determined') {
      status = raw
    } else {
      // 'restricted' → 视为 denied（家长控制或企业策略限制）
      status = 'denied'
    }
    return { status, platform }
  }

  // Windows / Linux 不支持 systemPreferences 麦克风权限查询
  return { status: 'unsupported', platform }
}

export async function requestMicrophonePermission(): Promise<MicPermissionResult> {
  const platform = getPlatform()

  if (platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return {
      status: granted ? 'granted' : 'denied',
      platform,
    }
  }

  // Windows / Linux 返回 unsupported，由渲染进程 getUserMedia 触发系统弹窗
  return { status: 'unsupported', platform }
}
