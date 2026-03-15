/**
 * Nano Banana 生图工具模块（Chat 模式）
 *
 * 基于 Gemini Image Generation API 提供 AI 生图能力。
 * 支持文生图、参考图编辑、多轮连续修改。
 * 凭据存储在 ~/.proma/chat-tools.json 的 toolCredentials 中。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@proma/core'
import type { ChatToolMeta, FileAttachment } from '@proma/shared'
import { randomUUID } from 'node:crypto'
import { getToolCredentials } from '../chat-tool-config'
import { saveAttachment, readAttachmentAsBase64, isImageAttachment } from '../attachment-service'

// ===== Gemini API 类型（REST API 使用 camelCase） =====

interface GeminiInlineData {
  mimeType: string
  data: string
}

interface GeminiPart {
  text?: string
  inlineData?: GeminiInlineData
  /** Gemini 多轮对话必需：模型生成图片时附带的签名，回传时原样保留 */
  thoughtSignature?: string
  /** snake_case 兼容（部分 API 版本） */
  thought_signature?: string
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[]
    role: string
  }
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  error?: { message: string; code: number }
}

// ===== 多轮对话历史 =====

/** 每个 conversationId 对应的 Gemini 对话历史 */
const conversationHistory = new Map<string, GeminiContent[]>()

// ===== 工具执行上下文 =====

/** Nano Banana 工具执行所需的额外上下文 */
export interface NanoBananaContext {
  /** 对话 ID（用于保存附件和管理对话历史） */
  conversationId: string
  /** 当前用户消息的附件列表 */
  currentAttachments?: FileAttachment[]
  /** 前一轮用户消息的附件 */
  previousUserAttachments?: FileAttachment[]
  /** 前一轮助手消息的附件 */
  previousAssistantAttachments?: FileAttachment[]
}

// ===== 默认配置 =====

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview'

// ===== 工具元数据 =====

export const NANO_BANANA_TOOL_META: ChatToolMeta = {
  id: 'nano-banana',
  name: 'Nano Banana',
  description: 'AI 图片生成与编辑（基于 Gemini Image Generation）',
  params: [
    { name: 'prompt', type: 'string', description: '图片生成/编辑描述', required: true },
  ],
  icon: 'ImagePlus',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<nano_banana_instructions>
你拥有 AI 图片生成和编辑能力（Nano Banana）。

**generate_image — 生成/编辑图片：**
当用户需要创建或修改图片时调用：
- 用户要求画画、生成图片、创作插图
- 用户上传了图片并要求修改、编辑、调整
- 用户想要基于描述生成视觉内容

**参数说明：**
- prompt: 详细描述想要生成的图片内容，用英文描述效果最佳
- aspectRatio: 可选宽高比 "1:1"(默认) / "16:9" / "4:3" / "9:16" / "3:4"
- imageSize: 可选分辨率 "auto"(默认) / "1K" / "2K" / "4K"
- useReferenceImages: 当用户上传了参考图或要求修改之前生成的图片时设为 true

**使用技巧：**
- 生成新图片时用详细的英文描述
- 编辑图片时设置 useReferenceImages: true，并在 prompt 中描述要做的修改
- 支持连续修改：多次调用时会自动保持上下文
</nano_banana_instructions>`,
}

// ===== 工具定义（ToolDefinition 格式，传给 Provider） =====

export const NANO_BANANA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'generate_image',
    description: 'Generate or edit images using AI. Supports text-to-image generation, reference image editing, and iterative modifications with context.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate or the edits to make. English descriptions work best.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio of the generated image',
          enum: ['1:1', '16:9', '4:3', '9:16', '3:4'],
        },
        imageSize: {
          type: 'string',
          description: 'Resolution of the generated image',
          enum: ['auto', '1K', '2K', '4K'],
        },
        useReferenceImages: {
          type: 'string',
          description: 'Set to "true" to use uploaded reference images or previously generated images for editing',
          enum: ['true', 'false'],
        },
      },
      required: ['prompt'],
    },
  },
]

// ===== 可用性检查 =====

/**
 * 检查 Nano Banana 工具是否可用（API Key 已配置）
 */
export function isNanoBananaAvailable(): boolean {
  const credentials = getToolCredentials('nano-banana')
  return !!credentials.apiKey
}

// ===== 工具执行 =====

/** 工具名称集合 */
const NANO_BANANA_TOOL_NAMES = new Set(['generate_image'])

/**
 * 判断是否为 Nano Banana 工具调用
 */
export function isNanoBananaToolCall(toolName: string): boolean {
  return NANO_BANANA_TOOL_NAMES.has(toolName)
}

/**
 * 收集参考图的 base64 数据
 *
 * 按时间从早到晚排列：前一轮用户附件 → 前一轮助手附件 → 当前用户附件
 */
function collectReferenceImages(context: NanoBananaContext): GeminiPart[] {
  const parts: GeminiPart[] = []

  const allAttachments: FileAttachment[] = [
    ...(context.previousUserAttachments ?? []),
    ...(context.previousAssistantAttachments ?? []),
    ...(context.currentAttachments ?? []),
  ]

  for (const attachment of allAttachments) {
    if (!isImageAttachment(attachment.mediaType)) continue

    try {
      const base64 = readAttachmentAsBase64(attachment.localPath)
      parts.push({
        inlineData: {
          mimeType: attachment.mediaType,
          data: base64,
        },
      })
    } catch (error) {
      console.warn(`[Nano Banana] 读取参考图失败: ${attachment.localPath}`, error)
    }
  }

  return parts
}

/**
 * Gemini 多轮对话中，模型响应包含 thoughtSignature 后，
 * 后续所有 user 消息的 text part 也必须携带 thoughtSignature。
 * 使用 Gemini 官方提供的跳过验证占位符。
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */
const DUMMY_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

/** 检查对话历史中是否存在 thoughtSignature */
function historyHasThoughtSignature(history: GeminiContent[]): boolean {
  return history.some((c) =>
    c.parts.some((p) => p.thoughtSignature || p.thought_signature),
  )
}

/**
 * 构建 Gemini API 请求体
 */
function buildGeminiRequest(
  prompt: string,
  referenceImageParts: GeminiPart[],
  history: GeminiContent[],
  options: {
    aspectRatio?: string
    imageSize?: string
  },
): Record<string, unknown> {
  // 多轮对话中 model 响应含 thoughtSignature 时，新 user 的 text part 也必须带签名
  const needsSignature = history.length > 0 && historyHasThoughtSignature(history)

  const userParts: GeminiPart[] = [
    ...referenceImageParts,
    {
      text: prompt,
      ...(needsSignature && { thoughtSignature: DUMMY_THOUGHT_SIGNATURE }),
    },
  ]

  // 合并历史 + 当前用户消息
  const contents: GeminiContent[] = [
    ...history,
    { role: 'user', parts: userParts },
  ]

  const generationConfig: Record<string, unknown> = {
    responseModalities: ['TEXT', 'IMAGE'],
  }

  // 图片配置
  const imageConfig: Record<string, unknown> = {}
  if (options.aspectRatio && options.aspectRatio !== '1:1') {
    imageConfig.aspectRatio = options.aspectRatio
  }
  if (options.imageSize && options.imageSize !== 'auto') {
    imageConfig.imageSize = options.imageSize
  }
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig
  }

  return { contents, generationConfig }
}

/**
 * 执行 Nano Banana 工具调用
 */
export async function executeNanoBananaTool(
  toolCall: ToolCall,
  context: NanoBananaContext,
): Promise<ToolResult> {
  const credentials = getToolCredentials('nano-banana')

  if (!credentials.apiKey) {
    return {
      toolCallId: toolCall.id,
      content: 'Nano Banana 未配置 API Key',
      isError: true,
    }
  }

  try {
    const prompt = toolCall.arguments.prompt as string
    const aspectRatio = toolCall.arguments.aspectRatio as string | undefined
    const imageSize = toolCall.arguments.imageSize as string | undefined
    const useReferenceImages = toolCall.arguments.useReferenceImages === 'true'

    if (!prompt) {
      return {
        toolCallId: toolCall.id,
        content: '参数缺失: prompt',
        isError: true,
      }
    }

    const baseUrl = credentials.baseUrl?.trim() || DEFAULT_BASE_URL
    const model = credentials.model?.trim() || DEFAULT_MODEL

    // 收集参考图
    const referenceImageParts = useReferenceImages ? collectReferenceImages(context) : []

    // 获取对话历史
    const history = conversationHistory.get(context.conversationId) ?? []

    // 构建请求
    const requestBody = buildGeminiRequest(prompt, referenceImageParts, history, {
      aspectRatio,
      imageSize,
    })

    const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${credentials.apiKey}`

    console.log(`[Nano Banana] 调用 Gemini API: model=${model}, prompt="${prompt.slice(0, 50)}..."`)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Nano Banana] API 请求失败 (${response.status}):`, errorText)
      return {
        toolCallId: toolCall.id,
        content: `Gemini API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`,
        isError: true,
      }
    }

    const data = (await response.json()) as GeminiResponse

    if (data.error) {
      return {
        toolCallId: toolCall.id,
        content: `Gemini API 错误: ${data.error.message}`,
        isError: true,
      }
    }

    if (!data.candidates || data.candidates.length === 0) {
      return {
        toolCallId: toolCall.id,
        content: '未生成任何内容',
        isError: true,
      }
    }

    const parts = data.candidates![0].content.parts
    console.log(`[Nano Banana] 响应包含 ${parts.length} 个 parts，类型:`, parts.map((p) => p.inlineData ? `image(${p.inlineData.mimeType})` : `text(${(p.text ?? '').slice(0, 30)})`))
    const generatedAttachments: FileAttachment[] = []
    const textParts: string[] = []

    // 解析响应：提取图片和文本
    for (const part of parts) {
      if (part.inlineData) {
        // 保存生成的图片为附件
        const ext = part.inlineData.mimeType === 'image/jpeg' ? '.jpg' : '.png'
        const result = saveAttachment({
          conversationId: context.conversationId,
          filename: `nano-banana-${randomUUID().slice(0, 8)}${ext}`,
          mediaType: part.inlineData.mimeType,
          data: part.inlineData.data,
        })
        generatedAttachments.push(result.attachment)
      } else if (part.text) {
        textParts.push(part.text)
      }
    }

    // 更新对话历史（用于多轮连续修改）
    // 注意：必须原样保留 model 响应中的 parts（含 thoughtSignature），否则多轮编辑会报错
    const userContent: GeminiContent = {
      role: 'user',
      parts: [...referenceImageParts, { text: prompt }],
    }
    const modelContent: GeminiContent = {
      role: 'model',
      parts, // 直接使用原始响应 parts，保留 thoughtSignature 等元数据
    }
    const updatedHistory = [...history, userContent, modelContent]
    conversationHistory.set(context.conversationId, updatedHistory)

    // 构建返回结果
    const imageCount = generatedAttachments.length
    const resultText = imageCount > 0
      ? `图片已成功生成（${imageCount} 张）${textParts.length > 0 ? `\n\n${textParts.join('\n')}` : ''}`
      : textParts.join('\n') || '未生成图片内容'

    return {
      toolCallId: toolCall.id,
      content: resultText,
      generatedAttachments: generatedAttachments.length > 0 ? generatedAttachments : undefined,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[Nano Banana] 执行失败:`, error)
    return {
      toolCallId: toolCall.id,
      content: `图片生成失败: ${msg}`,
      isError: true,
    }
  }
}

/**
 * 清除对话的生图历史（对话删除时调用）
 */
export function clearNanoBananaHistory(conversationId: string): void {
  conversationHistory.delete(conversationId)
}
