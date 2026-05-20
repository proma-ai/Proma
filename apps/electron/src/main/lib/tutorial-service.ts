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

    // 3. 追加 user 消息（携带教程附件作为 AI 的参考知识库）
    const now = Date.now()
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      content: '你好，我是 Proma 的新用户，希望快速上手。这是完整的使用教程，作为你的参考。',
      createdAt: now,
      attachments: [attachment],
    }
    appendMessage(meta.id, userMessage)

    // 4. 追加 assistant 欢迎消息（引导式对话：先了解用户，再生成个性化最佳实践）
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: `你好，欢迎来到 Proma！Proma 是一个通用的 Agent，其实它可以完成任何事，说实话这也挺难的，因为你要构建完整的工作环境才能做到，这会涉及到一些新的概念或者思考方式，不过别担心，我们做了很多设计可以帮助你靠谱稳定的越用越好用。

在介绍功能之前，想先认识一下你：

1. 怎么称呼你？
2. 你的职业或主要角色是什么？（比如独立开发者、产品经理、数据分析师、运营、学生……）
3. 你最近在做什么工作或项目？有哪些场景或痛点想交给 AI 帮忙？

了解你的背景之后，我会为你单独整理一份专属的 Proma 使用最佳实践——告诉你哪些功能最值得用、推荐的 Skills / MCP 配置，以及贴合你场景的工作流模板。

直接在下面回复就好，可以一次说完，也可以分几条慢慢聊。`,
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
