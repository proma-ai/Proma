/**
 * 教程服务
 *
 * 负责读取教程内容和创建欢迎对话。
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { createConversation, appendMessage } from './conversation-manager'
import { getConversationAttachmentsDir } from './config-paths'
import type { ConversationMeta, FileAttachment, ChatMessage } from '@proma/shared'

/**
 * 获取教程文件路径
 *
 * 开发模式：从 monorepo 根目录读取
 * 生产模式：从 extraResources 读取
 */
function getTutorialFilePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'tutorial.md')
  }
  // 开发模式：app.getAppPath() → apps/electron/
  return join(app.getAppPath(), '../../tutorial/tutorial.md')
}

/**
 * 读取教程内容
 *
 * @returns 教程 markdown 文本，读取失败返回 null
 */
export function getTutorialContent(): string | null {
  const filePath = getTutorialFilePath()

  if (!existsSync(filePath)) {
    console.warn('[教程服务] 教程文件不存在:', filePath)
    return null
  }

  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    console.error('[教程服务] 读取教程文件失败:', error)
    return null
  }
}

/**
 * 创建欢迎对话
 *
 * 创建一个预填教程内容的 Chat 对话：
 * 1. 创建对话
 * 2. 将教程文件保存为附件
 * 3. 追加 user 消息（携带教程附件）
 * 4. 追加 assistant 欢迎消息
 *
 * @returns 对话元数据，失败返回 null
 */
export function createWelcomeConversation(): ConversationMeta | null {
  const tutorialContent = getTutorialContent()
  if (!tutorialContent) {
    console.warn('[教程服务] 无法读取教程内容，跳过创建欢迎对话')
    return null
  }

  try {
    // 1. 创建对话
    const meta = createConversation('了解 Proma')

    // 2. 保存教程文件为附件
    const attachmentId = randomUUID()
    const attachmentFilename = 'Proma 使用教程.md'
    const localPath = `${meta.id}/${attachmentId}.md`
    const dir = getConversationAttachmentsDir(meta.id)
    const fullPath = join(dir, `${attachmentId}.md`)

    // 去掉图片标记，保留纯文本（图片在 Chat 上下文中无意义）
    const cleanedContent = tutorialContent.replace(/!\[.*?\]\(.*?\)\n*/g, '')
    writeFileSync(fullPath, cleanedContent, 'utf-8')

    const attachment: FileAttachment = {
      id: attachmentId,
      filename: attachmentFilename,
      mediaType: 'text/markdown',
      localPath,
      size: Buffer.byteLength(cleanedContent, 'utf-8'),
    }

    // 3. 追加 user 消息（携带教程附件）
    const now = Date.now()
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      content: '请帮我了解 Proma 的功能和使用方式，我附上了完整的使用教程作为参考。',
      createdAt: now,
      attachments: [attachment],
    }
    appendMessage(meta.id, userMessage)

    // 4. 追加 assistant 欢迎消息
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: `你好，欢迎使用 Proma！我已经阅读了完整的使用教程。你可以向我提问来快速了解 Proma，比如：

- Proma 可以做什么？
- 如何配置 AI 供应商渠道？
- Chat 和 Agent 模式有什么区别？
- 什么是 Skills 和 MCP？
- 如何远程使用 Proma？

直接输入你的问题并发送吧！`,
      createdAt: now + 1,
      model: 'Proma',
    }
    appendMessage(meta.id, assistantMessage)

    console.log(`[教程服务] 已创建欢迎对话: ${meta.id}`)
    return meta
  } catch (error) {
    console.error('[教程服务] 创建欢迎对话失败:', error)
    return null
  }
}
