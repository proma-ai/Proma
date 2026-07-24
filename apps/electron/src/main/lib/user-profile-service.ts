/**
 * 用户档案服务
 *
 * 管理用户档案（用户名 + 头像）的读写。
 * 存储在 ~/.proma/user-profile.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { BrowserWindow } from 'electron'
import { getUserProfilePath } from './config-paths'
import { DEFAULT_USER_AVATAR, DEFAULT_USER_NAME, USER_PROFILE_IPC_CHANNELS } from '../../types'
import type { UserProfile } from '../../types'

/**
 * 获取用户档案
 *
 * 如果文件不存在，返回默认档案。
 */
export function getUserProfile(): UserProfile {
  const filePath = getUserProfilePath()

  if (!existsSync(filePath)) {
    return {
      userName: DEFAULT_USER_NAME,
      avatar: DEFAULT_USER_AVATAR,
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<UserProfile>
    return {
      userName: data.userName || DEFAULT_USER_NAME,
      avatar: data.avatar || DEFAULT_USER_AVATAR,
    }
  } catch (error) {
    console.error('[用户档案] 读取失败:', error)
    return {
      userName: DEFAULT_USER_NAME,
      avatar: DEFAULT_USER_AVATAR,
    }
  }
}

/**
 * 更新用户档案
 *
 * 合并更新字段并写入文件。
 */
export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const current = getUserProfile()
  const updated: UserProfile = {
    ...current,
    ...updates,
  }

  const filePath = getUserProfilePath()

  try {
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
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
