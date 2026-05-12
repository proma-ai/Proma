/**
 * 存储管理服务
 *
 * 提供磁盘用量统计、孤儿数据检测和清理功能。
 * 由设置面板"磁盘管理"Tab 和启动时自动清理逻辑调用。
 */

import { existsSync, readdirSync, statSync, unlinkSync, rmSync, lstatSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { app } from 'electron'
import {
  getConfigDir,
  getAgentSessionsDir,
  getSdkConfigDir,
  getAgentWorkspacesDir,
  getAttachmentsDir,
  getConversationsDir,
} from './config-paths'
import { listAgentSessions } from './agent-session-manager'
import { listAgentWorkspaces } from './agent-workspace-manager'

// ─── 类型定义 ───

export type StorageCategoryKey =
  | 'agent-sessions'
  | 'sdk-config'
  | 'workspaces'
  | 'conversations'
  | 'attachments'
  | 'temp-files'

export interface StorageCategory {
  label: string
  key: StorageCategoryKey
  bytes: number
  count: number
  hasOrphans: boolean
  orphanBytes: number
  orphanCount: number
}

export interface StorageStats {
  categories: StorageCategory[]
  totalBytes: number
  calculatedAt: number
}

export interface CleanupOptions {
  categories: StorageCategoryKey[]
  orphansOnly: boolean
  archivedBeforeDays: number
}

export interface CleanupResult {
  freedBytes: number
  deletedCount: number
  errors: string[]
}

// ─── 工具函数 ───

function getDirSize(dirPath: string): { bytes: number; count: number } {
  let bytes = 0
  let count = 0
  if (!existsSync(dirPath)) return { bytes, count }

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const sub = getDirSize(fullPath)
          bytes += sub.bytes
          count += sub.count
        } else if (entry.isFile()) {
          bytes += statSync(fullPath).size
          count++
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* skip inaccessible dir */ }
  return { bytes, count }
}

function safeUnlink(filePath: string): number {
  try {
    const size = statSync(filePath).size
    unlinkSync(filePath)
    return size
  } catch {
    return 0
  }
}

function safeRmDir(dirPath: string): number {
  try {
    const { bytes } = getDirSize(dirPath)
    rmSync(dirPath, { recursive: true, force: true })
    return bytes
  } catch {
    return 0
  }
}

// ─── 统计 ───

function getActiveSessionIds(): Set<string> {
  return new Set(listAgentSessions().map((s) => s.id))
}

function getActiveSdkSessionIds(): Set<string> {
  const ids = new Set<string>()
  for (const s of listAgentSessions()) {
    if (s.sdkSessionId) ids.add(s.sdkSessionId)
    if (s.forkSourceSdkSessionId) ids.add(s.forkSourceSdkSessionId)
  }
  return ids
}

function getActiveWorkspaceSlugs(): Set<string> {
  return new Set(listAgentWorkspaces().map((w) => w.slug))
}

function calcAgentSessionsCategory(): StorageCategory {
  const dir = getAgentSessionsDir()
  const activeIds = getActiveSessionIds()
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0

  if (existsSync(dir)) {
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.jsonl')) continue
        const fullPath = join(dir, file)
        try {
          const size = statSync(fullPath).size
          const id = basename(file, '.jsonl')
          bytes += size
          count++
          if (!activeIds.has(id)) {
            orphanBytes += size
            orphanCount++
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return {
    label: 'Agent 会话记录',
    key: 'agent-sessions',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
  }
}

function calcSdkConfigCategory(): StorageCategory {
  const sdkDir = getSdkConfigDir()
  const activeSdkIds = getActiveSdkSessionIds()
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0

  const projectsDir = join(sdkDir, 'projects')
  if (existsSync(projectsDir)) {
    try {
      for (const hashDir of readdirSync(projectsDir)) {
        const projPath = join(projectsDir, hashDir)
        if (!lstatSync(projPath).isDirectory()) continue
        try {
          for (const file of readdirSync(projPath)) {
            if (!file.endsWith('.jsonl')) continue
            const fullPath = join(projPath, file)
            try {
              const size = statSync(fullPath).size
              const sdkId = basename(file, '.jsonl')
              bytes += size
              count++
              if (!activeSdkIds.has(sdkId)) {
                orphanBytes += size
                orphanCount++
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const fileHistoryDir = join(sdkDir, 'file-history')
  if (existsSync(fileHistoryDir)) {
    try {
      for (const sdkId of readdirSync(fileHistoryDir)) {
        const histPath = join(fileHistoryDir, sdkId)
        if (!lstatSync(histPath).isDirectory()) continue
        const sub = getDirSize(histPath)
        bytes += sub.bytes
        count += sub.count
        if (!activeSdkIds.has(sdkId)) {
          orphanBytes += sub.bytes
          orphanCount += sub.count
        }
      }
    } catch { /* skip */ }
  }

  // sdk-config 其他子目录（sessions, backups 等）
  if (existsSync(sdkDir)) {
    try {
      for (const entry of readdirSync(sdkDir)) {
        if (entry === 'projects' || entry === 'file-history') continue
        const fullPath = join(sdkDir, entry)
        try {
          if (lstatSync(fullPath).isDirectory()) {
            const sub = getDirSize(fullPath)
            bytes += sub.bytes
            count += sub.count
          } else {
            bytes += statSync(fullPath).size
            count++
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return {
    label: 'SDK 会话数据',
    key: 'sdk-config',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
  }
}

function calcWorkspacesCategory(): StorageCategory {
  const wsDir = getAgentWorkspacesDir()
  const activeIds = getActiveSessionIds()
  const activeSlugs = getActiveWorkspaceSlugs()
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0

  if (existsSync(wsDir)) {
    try {
      for (const slug of readdirSync(wsDir)) {
        const slugDir = join(wsDir, slug)
        if (!lstatSync(slugDir).isDirectory()) continue

        for (const entry of readdirSync(slugDir)) {
          const entryPath = join(slugDir, entry)
          if (!lstatSync(entryPath).isDirectory()) continue
          // workspace-files, skills, skills-inactive 等元目录不算孤儿
          if (['workspace-files', 'skills', 'skills-inactive', '.claude-plugin'].includes(entry)) {
            const sub = getDirSize(entryPath)
            bytes += sub.bytes
            count += sub.count
            continue
          }
          const sub = getDirSize(entryPath)
          bytes += sub.bytes
          count += sub.count
          // session 目录的 ID 不在活跃列表中 → 孤儿
          if (!activeIds.has(entry) && !activeSlugs.has(entry)) {
            orphanBytes += sub.bytes
            orphanCount++
          }
        }
      }
    } catch { /* skip */ }
  }

  return {
    label: '工作区文件',
    key: 'workspaces',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
  }
}

function calcConversationsCategory(): StorageCategory {
  const dir = getConversationsDir()
  const { bytes, count } = getDirSize(dir)
  return {
    label: '对话记录',
    key: 'conversations',
    bytes, count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
  }
}

function calcAttachmentsCategory(): StorageCategory {
  const dir = getAttachmentsDir()
  const { bytes, count } = getDirSize(dir)
  return {
    label: '附件文件',
    key: 'attachments',
    bytes, count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
  }
}

function calcTempFilesCategory(): StorageCategory {
  const previewDir = join(tmpdir(), 'proma-preview')
  const installerDir = join(app.getPath('temp'), 'proma-installers')
  const preview = getDirSize(previewDir)
  const installer = getDirSize(installerDir)
  return {
    label: '临时预览/安装文件',
    key: 'temp-files',
    bytes: preview.bytes + installer.bytes,
    count: preview.count + installer.count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
  }
}

export async function calculateStorageStats(): Promise<StorageStats> {
  const categories = [
    calcAgentSessionsCategory(),
    calcSdkConfigCategory(),
    calcWorkspacesCategory(),
    calcConversationsCategory(),
    calcAttachmentsCategory(),
    calcTempFilesCategory(),
  ]
  return {
    categories,
    totalBytes: categories.reduce((sum, c) => sum + c.bytes, 0),
    calculatedAt: Date.now(),
  }
}

// ─── 清理 ───

export async function cleanupTempFiles(): Promise<CleanupResult> {
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const previewDir = join(tmpdir(), 'proma-preview')
  if (existsSync(previewDir)) {
    try {
      for (const file of readdirSync(previewDir)) {
        const freed = safeUnlink(join(previewDir, file))
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理预览文件失败: ${e}`)
    }
  }

  const installerDir = join(app.getPath('temp'), 'proma-installers')
  if (existsSync(installerDir)) {
    try {
      for (const file of readdirSync(installerDir)) {
        const freed = safeUnlink(join(installerDir, file))
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理安装文件失败: ${e}`)
    }
  }

  if (freedBytes > 0) {
    console.log(`[存储清理] 临时文件: 释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB, 删除 ${deletedCount} 个文件`)
  }
  return { freedBytes, deletedCount, errors }
}

function cleanupOrphanAgentSessions(): CleanupResult {
  const dir = getAgentSessionsDir()
  const activeIds = getActiveSessionIds()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  if (!existsSync(dir)) return { freedBytes, deletedCount, errors }

  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue
      const id = basename(file, '.jsonl')
      if (activeIds.has(id)) continue
      const freed = safeUnlink(join(dir, file))
      if (freed > 0) { freedBytes += freed; deletedCount++ }
    }
  } catch (e) {
    errors.push(`清理孤儿会话文件失败: ${e}`)
  }

  return { freedBytes, deletedCount, errors }
}

function cleanupOrphanSdkConfig(): CleanupResult {
  const sdkDir = getSdkConfigDir()
  const activeSdkIds = getActiveSdkSessionIds()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const projectsDir = join(sdkDir, 'projects')
  if (existsSync(projectsDir)) {
    try {
      for (const hashDir of readdirSync(projectsDir)) {
        const projPath = join(projectsDir, hashDir)
        if (!lstatSync(projPath).isDirectory()) continue
        try {
          for (const file of readdirSync(projPath)) {
            if (!file.endsWith('.jsonl')) continue
            const sdkId = basename(file, '.jsonl')
            if (activeSdkIds.has(sdkId)) continue
            const freed = safeUnlink(join(projPath, file))
            if (freed > 0) { freedBytes += freed; deletedCount++ }
          }
          // 若目录为空则删除
          if (readdirSync(projPath).length === 0) {
            rmSync(projPath, { recursive: true, force: true })
          }
        } catch { /* skip */ }
      }
    } catch (e) {
      errors.push(`清理孤儿 SDK projects 失败: ${e}`)
    }
  }

  const fileHistoryDir = join(sdkDir, 'file-history')
  if (existsSync(fileHistoryDir)) {
    try {
      for (const sdkId of readdirSync(fileHistoryDir)) {
        if (activeSdkIds.has(sdkId)) continue
        const histPath = join(fileHistoryDir, sdkId)
        if (!lstatSync(histPath).isDirectory()) continue
        const freed = safeRmDir(histPath)
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理孤儿 file-history 失败: ${e}`)
    }
  }

  return { freedBytes, deletedCount, errors }
}

function cleanupOrphanWorkspaces(): CleanupResult {
  const wsDir = getAgentWorkspacesDir()
  const activeIds = getActiveSessionIds()
  const activeSlugs = getActiveWorkspaceSlugs()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  if (!existsSync(wsDir)) return { freedBytes, deletedCount, errors }

  try {
    for (const slug of readdirSync(wsDir)) {
      const slugDir = join(wsDir, slug)
      if (!lstatSync(slugDir).isDirectory()) continue

      for (const entry of readdirSync(slugDir)) {
        if (['workspace-files', 'skills', 'skills-inactive', '.claude-plugin'].includes(entry)) continue
        const entryPath = join(slugDir, entry)
        if (!lstatSync(entryPath).isDirectory()) continue
        if (activeIds.has(entry) || activeSlugs.has(entry)) continue
        const freed = safeRmDir(entryPath)
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    }
  } catch (e) {
    errors.push(`清理孤儿工作区目录失败: ${e}`)
  }

  return { freedBytes, deletedCount, errors }
}

function cleanupArchivedSessions(beforeDays: number): CleanupResult {
  const cutoff = Date.now() - beforeDays * 24 * 60 * 60 * 1000
  const sessions = listAgentSessions()
  const sdkDir = getSdkConfigDir()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  for (const session of sessions) {
    if (!session.archived || session.updatedAt > cutoff) continue

    // 删除 JSONL 消息文件
    const msgPath = join(getAgentSessionsDir(), `${session.id}.jsonl`)
    if (existsSync(msgPath)) {
      const freed = safeUnlink(msgPath)
      if (freed > 0) { freedBytes += freed; deletedCount++ }
    }

    // 清理 SDK file-history
    if (session.sdkSessionId) {
      const histDir = join(sdkDir, 'file-history', session.sdkSessionId)
      if (existsSync(histDir)) {
        const freed = safeRmDir(histDir)
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    }
  }

  if (freedBytes > 0) {
    console.log(`[存储清理] 归档数据: 释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB, 删除 ${deletedCount} 项`)
  }
  return { freedBytes, deletedCount, errors }
}

export async function cleanupStorage(options: CleanupOptions): Promise<CleanupResult> {
  let totalFreed = 0, totalDeleted = 0
  const allErrors: string[] = []

  const merge = (r: CleanupResult) => {
    totalFreed += r.freedBytes
    totalDeleted += r.deletedCount
    allErrors.push(...r.errors)
  }

  for (const cat of options.categories) {
    if (cat === 'temp-files') {
      merge(await cleanupTempFiles())
      continue
    }

    if (options.orphansOnly) {
      switch (cat) {
        case 'agent-sessions': merge(cleanupOrphanAgentSessions()); break
        case 'sdk-config': merge(cleanupOrphanSdkConfig()); break
        case 'workspaces': merge(cleanupOrphanWorkspaces()); break
      }
    } else if (options.archivedBeforeDays > 0) {
      if (cat === 'agent-sessions' || cat === 'sdk-config') {
        merge(cleanupArchivedSessions(options.archivedBeforeDays))
      }
    }
  }

  if (totalFreed > 0) {
    console.log(`[存储清理] 总计释放 ${(totalFreed / 1024 / 1024).toFixed(1)} MB, 删除 ${totalDeleted} 项`)
  }
  return { freedBytes: totalFreed, deletedCount: totalDeleted, errors: allErrors }
}
