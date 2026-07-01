/**
 * 默认 App 探测成功缓存
 *
 * 只持久化成功结果。系统探测依赖 Swift/LaunchServices/图标服务，失败可能是瞬时的，
 * 不应把 null 写入本地配置后长期隐藏按钮。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { DefaultAppInfo } from '@proma/shared'
import { getDefaultAppsCachePath } from './config-paths'

interface DefaultAppCacheEntry extends DefaultAppInfo {
  updatedAt: number
}

interface DefaultAppCacheFile {
  version: 1
  entries: Record<string, DefaultAppCacheEntry>
}

const CACHE_VERSION = 1
const MAX_CACHE_ENTRIES = 80

let loaded = false
let entries = new Map<string, DefaultAppCacheEntry>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeEntry(value: unknown): DefaultAppCacheEntry | null {
  if (!isRecord(value)) return null
  const { name, appPath, iconDataUrl, updatedAt } = value
  if (
    typeof name !== 'string' ||
    typeof appPath !== 'string' ||
    typeof iconDataUrl !== 'string' ||
    typeof updatedAt !== 'number'
  ) {
    return null
  }
  if (!name || !appPath || !iconDataUrl) return null
  return { name, appPath, iconDataUrl, updatedAt }
}

function loadCache(): void {
  if (loaded) return
  loaded = true

  const cachePath = getDefaultAppsCachePath()
  if (!existsSync(cachePath)) return

  try {
    const raw = readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || !isRecord(parsed.entries)) return

    entries = new Map<string, DefaultAppCacheEntry>()
    for (const [key, value] of Object.entries(parsed.entries)) {
      const entry = normalizeEntry(value)
      if (entry) entries.set(key, entry)
    }
  } catch (error) {
    console.warn('[DefaultApp] 读取默认 App 缓存失败:', error)
  }
}

function persistCache(): void {
  const cachePath = getDefaultAppsCachePath()
  const sortedEntries = Array.from(entries.entries())
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CACHE_ENTRIES)

  entries = new Map(sortedEntries)

  const file: DefaultAppCacheFile = {
    version: CACHE_VERSION,
    entries: Object.fromEntries(sortedEntries),
  }

  try {
    writeFileSync(cachePath, JSON.stringify(file, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[DefaultApp] 写入默认 App 缓存失败:', error)
  }
}

export function getCachedDefaultAppInfo(cacheKey: string): DefaultAppInfo | null {
  loadCache()
  const entry = entries.get(cacheKey)
  if (!entry) return null
  return {
    name: entry.name,
    appPath: entry.appPath,
    iconDataUrl: entry.iconDataUrl,
  }
}

export function saveCachedDefaultAppInfo(cacheKey: string, info: DefaultAppInfo): void {
  loadCache()
  entries.set(cacheKey, {
    ...info,
    updatedAt: Date.now(),
  })
  persistCache()
}
