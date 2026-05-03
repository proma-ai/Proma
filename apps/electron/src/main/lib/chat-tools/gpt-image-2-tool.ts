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
  /** 本轮用户消息附带的图片 */
  currentAttachments?: FileAttachment[]
  /**
   * 最近 N 轮对话中所有消息的附件（user + assistant 生成图）
   * 按时间倒序（最新在前），由 chat-service 按 DEFAULT_REFERENCE_ROUNDS 计算
   */
  recentRoundsAttachments?: FileAttachment[]
}

/** 默认带进 edit 模式的参考图轮数上限 */
export const DEFAULT_REFERENCE_ROUNDS = 3

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
- size:
  - 文生图模式（useReferenceImages=false）："1024x1024"(方形,默认) / "1024x1536"(竖图) / "1536x1024"(横图) / "2048x2048"(2K方形) / "2048x1152"(2K横图) / "3840x2160"(4K横图) / "2160x3840"(4K竖图) / "auto"
  - 图片编辑模式（useReferenceImages=true）：**只能使用** "1024x1024" / "1024x1536" / "1536x1024"，不支持 2K/4K 和 auto
- quality: "low"(快/便宜) / "medium"(平衡,**默认，用户未明确指定时始终使用此值**) / "high"(精/慢/贵，仅用户明确要求高质量时使用)
- numberOfImages: 1-10，默认 1
- background: "transparent"(透明,仅 PNG) / "opaque" / "auto"
- useReferenceImages: 当用户上传了参考图或要求修改之前生成的图片时设为 true（走编辑接口）
</gpt_image_2_instructions>`,
}

// ===== 工具定义（ToolDefinition 格式） =====

export const GPT_IMAGE_2_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'generate_image_gpt',
    description: 'Generate or edit images using GPT Image 2. Pass useReferenceImages="true" to edit uploaded images instead of generating from scratch. IMPORTANT: when useReferenceImages="true", only sizes 1024x1024/1024x1536/1536x1024 are supported — do NOT use 2K/4K/auto sizes in edit mode.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate or the edits to make. Up to 32000 chars; English works best.',
        },
        size: {
          type: 'string',
          description: 'Image size. For text-to-image (useReferenceImages=false): 1024x1024=square, 1024x1536=portrait, 1536x1024=landscape, 2048x2048=2K square, 2048x1152=2K landscape, 3840x2160=4K landscape, 2160x3840=4K portrait, auto=let model decide. For edit mode (useReferenceImages=true): ONLY 1024x1024, 1024x1536, 1536x1024 are supported. Default 1024x1024.',
          enum: ['1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto'],
        },
        quality: {
          type: 'string',
          description: 'Generation quality. Default is "medium". Only use "high" when the user explicitly requests best/high quality. Only use "low" when the user explicitly requests fast/cheap/draft quality. If the user does not mention quality, always use "medium".',
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
          description: 'Set to "true" to use uploaded reference images or previously generated images for editing. When true, size must be one of: 1024x1024, 1024x1536, 1536x1024.',
          enum: ['true', 'false'],
        },
      },
      required: ['prompt'],
    },
  },
]

// ===== Edit 模式支持的 size 白名单 =====
// 上游 /v3/gpt-image-2-edit 只支持这三种尺寸，不支持 2K/4K/auto
const EDIT_SUPPORTED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024'])

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

/**
 * 收集编辑模式的参考图（base64 data URL 格式）
 *
 * 策略：
 * 1. 本轮用户上传的新图排在最前（最明确的编辑目标）
 * 2. 最近 N 轮历史消息的所有图片（按时间倒序，assistant 生成 + user 上传）
 * 3. 以 localPath 去重，避免同一张图被多次打包
 *
 * 最终一起作为 image 数组传给上游 edit 端点（API 支持数组）。
 */
function collectReferenceImagesAsBase64(context: GptImage2Context): string[] {
  const ordered: FileAttachment[] = []
  for (const a of context.currentAttachments ?? []) ordered.push(a)
  for (const a of context.recentRoundsAttachments ?? []) ordered.push(a)

  const seen = new Set<string>()
  const result: string[] = []
  for (const a of ordered) {
    if (!isImageAttachment(a.mediaType)) continue
    if (seen.has(a.localPath)) continue
    seen.add(a.localPath)
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

    const requestedSize = (toolCall.arguments.size as string | undefined) || '1024x1024'
    const quality = (toolCall.arguments.quality as string | undefined) || 'medium'
    const background = toolCall.arguments.background as string | undefined
    const useReferenceImages = toolCall.arguments.useReferenceImages === 'true'
    const numberOfImages = typeof toolCall.arguments.numberOfImages === 'number'
      ? Math.min(Math.max(Math.round(toolCall.arguments.numberOfImages), 1), 10)
      : 1

    // Edit 模式的 size 强制校验：上游编辑端点只支持 3 种尺寸，不支持 2K/4K/auto
    // 如果模型传了不支持的尺寸，降级到默认值 1024x1024 并记录警告
    let size = requestedSize
    if (useReferenceImages && !EDIT_SUPPORTED_SIZES.has(size)) {
      console.warn(`[GPT Image 2] Edit 模式不支持 size="${size}"，已降级为 1024x1024`)
      size = '1024x1024'
    }

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
