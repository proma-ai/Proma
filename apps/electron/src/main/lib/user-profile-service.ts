/**
 * 用户档案服务
 *
 * 管理用户档案（用户名 + 头像）的读写。
 * 存储在 ~/.proma/user-profile.json
 */

import { readFileSync, existsSync } from 'node:fs'
import { BrowserWindow } from 'electron'
import { getUserProfilePath } from './config-paths'
import { writeJsonFileAtomic } from './safe-file'
import { normalizeUserProfile } from '../../lib/user-profile'
import { USER_PROFILE_IPC_CHANNELS } from '../../types'
import type { UserProfile } from '../../types'

/**
 * 获取用户档案
 *
 * 如果文件不存在，返回默认档案。
 */
export function getUserProfile(): UserProfile {
  const filePath = getUserProfilePath()

  if (!existsSync(filePath)) {
    return normalizeUserProfile(undefined)
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    return normalizeUserProfile(JSON.parse(raw))
  } catch (error) {
    console.error('[用户档案] 读取失败:', error)
    return normalizeUserProfile(undefined)
  }
}

/**
 * 更新用户档案
 *
 * 合并更新字段并写入文件。
 */
export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const current = getUserProfile()
  // 未提供的 PATCH 字段保留当前值；显式无效字段回退默认值。
  // 保存、返回与广播同一份规范化数据，不能仅在下次读取时补默认值。
  const updated = normalizeUserProfile({ ...current, ...updates })

  const filePath = getUserProfilePath()

  try {
    writeJsonFileAtomic(filePath, updated)
    console.log(`[用户档案] 已更新: ${updated.userName}`)
  } catch (error) {
    console.error('[用户档案] 写入失败:', error)
    throw new Error('写入用户档案失败')
  }

  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(USER_PROFILE_IPC_CHANNELS.CHANGED, updated)
  })

  return updated
}
