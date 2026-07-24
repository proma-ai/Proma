import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { USER_PROFILE_IPC_CHANNELS } from '../../types'
import type { UserProfile } from '../../types'

type UserProfileService = typeof import('./user-profile-service')

let userProfileService: UserProfileService
let tempHome: string
const sentEvents: Array<[string, UserProfile]> = []

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  BrowserWindow: {
    getAllWindows: () => [{
      webContents: {
        send: (channel: string, profile: UserProfile) => sentEvents.push([channel, profile]),
      },
    }],
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-user-profile-'))
  userProfileService = await import('./user-profile-service')
})

beforeEach(() => {
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
  sentEvents.length = 0
})

afterAll(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

describe('用户档案变更通知', () => {
  test('Given 已打开的渲染窗口 When 更新本地用户档案 Then 持久化并广播完整新档案', () => {
    const updated = userProfileService.updateUserProfile({
      userName: 'Proma 用户',
      avatar: '🌟',
    })

    expect(updated).toEqual({ userName: 'Proma 用户', avatar: '🌟' })
    expect(userProfileService.getUserProfile()).toEqual(updated)
    expect(sentEvents).toEqual([[USER_PROFILE_IPC_CHANNELS.CHANGED, updated]])
  })
})
