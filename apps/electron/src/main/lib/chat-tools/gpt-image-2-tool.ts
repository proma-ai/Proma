/**
 * GPT Image 2 生图工具模块（Chat 模式）
 *
 * 通过 proma-api 代理调用上游 GPT Image 2 接口（仅云端模式）。
 * - 文生图：POST /tools/gpt-image-2/generate（无 image 字段）
 * - 图片编辑：POST /tools/gpt-image-2/generate（含 image 字段）
 *
 * 与 Nano Banana 不同：无多轮历史，每次调用相互独立。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@proma/core'
import type { ChatToolMeta, FileAttachment } from '@proma/shared'
import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getCloudApiConfig } from '@proma/cloud'
import { getToolCredentials } from '../chat-tool-config'
import { getAuthToken } from '../cloud-auth-service'
import { saveAttachment, readAttachmentAsBase64, isImageAttachment } from '../attachment-service'

// ===== 上游响应类型 =====

interface GptImage2Response {
  images?: string[]
  error?: { message?: string } | string
}

// ===== 工具执行上下文 =====

export interface GptImage2Context {
  conversationId: string
  currentAttachments?: FileAttachment[]
  previousUserAttachments?: FileAttachment[]
  previousAssistantAttachments?: FileAttachment[]
}

// ===== 工具元数据 =====

export const GPT_IMAGE_2_TOOL_META: ChatToolMeta = {
  id: 'gpt-image-2',
  name: 'GPT Image 2',
  description: 'AI 图片生成与编辑（基于 GPT Image 2，仅云端模式）',
  params: [
    { name: 'prompt', type: 'string', description: '图片生成/编辑描述', required: true },
  ],
  icon: 'ImagePlus',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<gpt_image_2_instructions>
你拥有 GPT Image 2 的 AI 图片生成和编辑能力。

**generate_image_gpt — 生成/编辑图片：**
当用户需要创建或修改图片时调用：
- 用户要求画画、生成图片、创作插图
- 用户上传了图片并要求修改、编辑、调整
- 用户想要基于描述生成视觉内容

**参数说明：**
- prompt: 详细描述想要生成的图片内容（支持中英文，英文效果更佳，最长 32000 字）
- size: "1024x1024"(方形,默认) / "1024x1536"(竖图) / "1536x1024"(横图) / "2048x2048"(2K方形) / "2048x1152"(2K横图) / "3840x2160"(4K横图) / "2160x3840"(4K竖图) / "auto"
- quality: "low"(快/便宜) / "medium"(平衡,默认) / "high"(精/慢/贵)
- numberOfImages: 1-10，默认 1
- background: "transparent"(透明,仅 PNG) / "opaque" / "auto"
- useReferenceImages: 当用户上传了参考图或要求修改之前生成的图片时设为 true（走编辑接口）
</gpt_image_2_instructions>`,
}

// ===== 工具定义（ToolDefinition 格式） =====

export const GPT_IMAGE_2_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'generate_image_gpt',
    description: 'Generate or edit images using GPT Image 2. Pass useReferenceImages="true" to edit uploaded images instead of generating from scratch.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate or the edits to make. Up to 32000 chars; English works best.',
        },
        size: {
          type: 'string',
          description: 'Image size. 1024x1024=square, 1024x1536=portrait, 1536x1024=landscape, 2048x2048=2K square, 2048x1152=2K landscape, 3840x2160=4K landscape, 2160x3840=4K portrait, auto=let model decide. Default 1024x1024.',
          enum: ['1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto'],
        },
        quality: {
          type: 'string',
          description: 'Generation quality (low=fast/cheap, high=best/expensive). Default medium.',
          enum: ['low', 'medium', 'high'],
        },
        numberOfImages: {
          type: 'number',
          description: 'Number of images to generate (1-10, default 1)',
        },
        background: {
          type: 'string',
          description: 'Background handling',
          enum: ['transparent', 'opaque', 'auto'],
        },
        useReferenceImages: {
          type: 'string',
          description: 'Set to "true" to use uploaded reference images for editing.',
          enum: ['true', 'false'],
        },
      },
      required: ['prompt'],
    },
  },
]

// ===== 可用性检查（仅云端） =====

export function isGptImage2Available(): boolean {
  const credentials = getToolCredentials('gpt-image-2')
  return credentials.cloudMode === 'true' && credentials.useCloud !== 'false'
}

// ===== 工具识别 =====

const GPT_IMAGE_2_TOOL_NAMES = new Set(['generate_image_gpt'])

export function isGptImage2ToolCall(toolName: string): boolean {
  return GPT_IMAGE_2_TOOL_NAMES.has(toolName)
}

// ===== 辅助：收集参考图（base64） =====

function collectReferenceImagesAsBase64(context: GptImage2Context): string[] {
  const all: FileAttachment[] = [
    ...(context.previousUserAttachments ?? []),
    ...(context.previousAssistantAttachments ?? []),
    ...(context.currentAttachments ?? []),
  ]

  const result: string[] = []
  for (const a of all) {
    if (!isImageAttachment(a.mediaType)) continue
    try {
      const base64 = readAttachmentAsBase64(a.localPath)
      result.push(`data:${a.mediaType};base64,${base64}`)
    } catch (error) {
      console.warn(`[GPT Image 2] 读取参考图失败: ${a.localPath}`, error)
    }
  }
  return result
}

// ===== 辅助：从 URL 下载图片为附件 =====

async function downloadImageToAttachment(
  url: string,
  conversationId: string,
): Promise<FileAttachment | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`[GPT Image 2] 下载图片失败 (${response.status}): ${url}`)
      return null
    }
    const contentType = response.headers.get('content-type') || 'image/png'
    const arrayBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    let ext = '.png'
    if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = '.jpg'
    else if (contentType.includes('webp')) ext = '.webp'
    // 也尝试从 URL 解析扩展名
    const urlExt = extname(new URL(url).pathname).toLowerCase()
    if (urlExt === '.jpg' || urlExt === '.jpeg') ext = '.jpg'
    else if (urlExt === '.png') ext = '.png'
    else if (urlExt === '.webp') ext = '.webp'

    const result = saveAttachment({
      conversationId,
      filename: `gpt-image-2-${randomUUID().slice(0, 8)}${ext}`,
      mediaType: contentType.split(';')[0]?.trim() || 'image/png',
      data: base64,
    })
    return result.attachment
  } catch (error) {
    console.error(`[GPT Image 2] 下载图片异常: ${url}`, error)
    return null
  }
}

// ===== 工具执行 =====

export async function executeGptImage2Tool(
  toolCall: ToolCall,
  context: GptImage2Context,
): Promise<ToolResult> {
  if (!isGptImage2Available()) {
    return {
      toolCallId: toolCall.id,
      content: 'GPT Image 2 仅支持云端模式，请确认已登录 Proma 云端账户',
      isError: true,
    }
  }

  const token = getAuthToken()
  if (!token) {
    return {
      toolCallId: toolCall.id,
      content: '云端生图失败：未登录',
      isError: true,
    }
  }

  try {
    const prompt = toolCall.arguments.prompt as string
    if (!prompt) {
      return {
        toolCallId: toolCall.id,
        content: '参数缺失: prompt',
        isError: true,
      }
    }

    const size = (toolCall.arguments.size as string | undefined) || '1024x1024'
    const quality = (toolCall.arguments.quality as string | undefined) || 'medium'
    const background = toolCall.arguments.background as string | undefined
    const useReferenceImages = toolCall.arguments.useReferenceImages === 'true'
    const numberOfImages = typeof toolCall.arguments.numberOfImages === 'number'
      ? Math.min(Math.max(Math.round(toolCall.arguments.numberOfImages), 1), 10)
      : 1

    // 收集参考图（编辑模式才传）
    let imageField: string | string[] | undefined
    if (useReferenceImages) {
      const refs = collectReferenceImagesAsBase64(context)
      if (refs.length === 0) {
        return {
          toolCallId: toolCall.id,
          content: '已请求参考图编辑模式，但未找到可用的图片附件',
          isError: true,
        }
      }
      imageField = refs.length === 1 ? refs[0] : refs
    }

    const body: Record<string, unknown> = {
      prompt,
      size,
      quality,
      n: numberOfImages,
    }
    if (background) body.background = background
    if (imageField !== undefined) body.image = imageField

    const { baseUrl } = getCloudApiConfig()
    console.log(`[GPT Image 2] 云端调用: edit=${useReferenceImages}, size=${size}, quality=${quality}, n=${numberOfImages}`)

    const response = await fetch(`${baseUrl}/tools/gpt-image-2/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[GPT Image 2] 云端请求失败 (${response.status}):`, errorText)
      return {
        toolCallId: toolCall.id,
        content: `图片生成失败 (${response.status}): ${errorText.slice(0, 200)}`,
        isError: true,
      }
    }

    const data = await response.json() as GptImage2Response
    if (data.error) {
      const msg = typeof data.error === 'string' ? data.error : (data.error.message ?? 'unknown')
      return {
        toolCallId: toolCall.id,
        content: `GPT Image 2 错误: ${msg}`,
        isError: true,
      }
    }

    const urls = data.images ?? []
    if (urls.length === 0) {
      return {
        toolCallId: toolCall.id,
        content: '未生成任何图片',
        isError: true,
      }
    }

    // 并行下载图片为本地附件
    const downloaded = await Promise.all(
      urls.map((url) => downloadImageToAttachment(url, context.conversationId)),
    )
    const generatedAttachments = downloaded.filter((a): a is FileAttachment => a !== null)

    if (generatedAttachments.length === 0) {
      return {
        toolCallId: toolCall.id,
        content: '图片下载失败',
        isError: true,
      }
    }

    return {
      toolCallId: toolCall.id,
      content: `图片已成功生成（${generatedAttachments.length} 张）`,
      generatedAttachments,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[GPT Image 2] 执行失败:`, error)
    return {
      toolCallId: toolCall.id,
      content: `图片生成失败: ${msg}`,
      isError: true,
    }
  }
}
