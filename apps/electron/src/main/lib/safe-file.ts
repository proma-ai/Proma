/**
 * 崩溃安全的 JSON 文件读写工具
 *
 * 解决系统强制关机/崩溃时 JSON 索引文件被截断导致数据丢失的问题。
 * - 写入：write-to-temp → rename（POSIX 原子操作）+ .bak 备份
 * - 读取：主文件 → .tmp 残留 → .bak 回退，多层容错
 */

import { writeFileSync, renameSync, existsSync, copyFileSync, readFileSync, unlinkSync } from 'node:fs'

/**
 * 原子写入 JSON 文件：write-to-temp → rename
 * 写入前自动保留 .bak 备份
 */
export function writeJsonFileAtomic(filePath: string, data: object, skipBackup = false): void {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'

  // 备份当前文件（如果存在且可读）
  if (!skipBackup && existsSync(filePath)) {
    try {
      copyFileSync(filePath, bakPath)
    } catch {
      // 备份失败不阻塞写入
    }
  }

  // 写入临时文件
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')

  // 原子重命名（POSIX rename 是原子操作）
  renameSync(tmpPath, filePath)
}

/**
 * 安全读取 JSON 索引文件
 * 优先读主文件，损坏则尝试 .tmp / .bak，都失败返回 null
 */
export function readJsonFileSafe<T>(filePath: string): T | null {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'

  // 1. 尝试读取主文件
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      if (raw.trim().length > 0) {
        return JSON.parse(raw) as T
      }
    } catch {
      console.warn(`[数据恢复] 主索引文件损坏: ${filePath}`)
    }
  }

  // 2. 检查是否有未完成的 .tmp 文件（上次 rename 前崩溃）
  if (existsSync(tmpPath)) {
    try {
      const raw = readFileSync(tmpPath, 'utf-8')
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw) as T
        // .tmp 有效 → 提升为主文件
        renameSync(tmpPath, filePath)
        console.log(`[数据恢复] 从 .tmp 文件恢复: ${filePath}`)
        return parsed
      }
    } catch {
      // .tmp 也损坏，继续 fallback
    }
    // 清理无效的 .tmp
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }

  // 3. Fallback 到 .bak
  if (existsSync(bakPath)) {
    try {
      const raw = readFileSync(bakPath, 'utf-8')
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw) as T
        // 用 .bak 恢复主文件（跳过备份，避免用损坏的主文件覆盖好的 .bak）
        writeJsonFileAtomic(filePath, parsed as object, true)
        console.log(`[数据恢复] 从 .bak 文件恢复: ${filePath}`)
        return parsed
      }
    } catch {
      console.error(`[数据恢复] .bak 文件也损坏: ${bakPath}`)
    }
  }

  return null // 全部失败，需要上层从 JSONL 重建
}
