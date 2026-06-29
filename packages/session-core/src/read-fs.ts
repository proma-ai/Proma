/**
 * 文件 IO 层 — 仅供 Node 侧（proma CLI / Electron 主进程）使用。
 *
 * 本文件 import 'node:fs'，因此**不能**进入浏览器可达的主 barrel（'@proma/session-core'）。
 * 它只通过子路径 '@proma/session-core/node' 暴露，避免 Vite 把 node:fs 打进渲染层 bundle。
 */
import { readFileSync } from 'node:fs'
import type { SDKMessage } from '@proma/shared'
import { readSessionMessagesFromString } from './read'

/**
 * 从磁盘读取一份会话 JSONL 并解析为 SDKMessage[]。
 */
export function readSessionMessages(filePath: string): SDKMessage[] {
  const raw = readFileSync(filePath, 'utf-8')
  return readSessionMessagesFromString(raw)
}
