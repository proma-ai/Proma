/**
 * GPT Image 2 MCP Server（Agent 模式）
 *
 * 通过 sdk.createSdkMcpServer() 创建 MCP 服务，注入到每个 Agent 会话。
 * 调用 proma-api 的 /tools/gpt-image-2/generate 代理（仅云端模式）。
 * 支持文生图和图片编辑（按 referenceImagePaths 是否提供路由）。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, resolve, isAbsolute, join } from 'node:path'
import { getCloudApiConfig } from '@proma/cloud'
import { getToolState, getToolCredentials } from '../chat-tool-config'
import { saveAttachment, isImageAttachment } from '../attachment-service'
import { getAuthToken } from '../cloud-auth-service'

// ===== 上游响应类型 =====

interface GptImage2Response {
  images?: string[]
  error?: { message?: string } | string
}

// ===== MCP 内容块类型 =====

interface McpTextContent {
  type: 'text'
  text: string
  [key: string]: unknown
}

interface McpImageContent {
  type: 'image'
  data: string
  mimeType: string
  [key: string]: unknown
}

type McpContent = McpTextContent | McpImageContent

interface McpToolResult {
  content: McpContent[]
  [key: string]: unknown
}

// ===== 文件 → MIME 映射 =====

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

function readReferenceImagesAsDataUrl(paths: string[], cwd?: string): string[] {
  const result: string[] = []
  for (const rawPath of paths) {
    try {
      const filePath = isAbsolute(rawPath) ? rawPath : resolve(cwd ?? process.cwd(), rawPath)
      if (!existsSync(filePath)) {
        console.warn(`[GPT Image 2 MCP] 参考图不存在: ${filePath}`)
        continue
      }
      const ext = extname(filePath).toLowerCase()
      const mimeType = EXT_TO_MIME[ext]
      if (!mimeType || !isImageAttachment(mimeType)) {
        console.warn(`[GPT Image 2 MCP] 非图片文件，跳过: ${filePath}`)
        continue
      }
      const data = readFileSync(filePath).toString('base64')
      result.push(`data:${mimeType};base64,${data}`)
    } catch (error) {
      console.warn(`[GPT Image 2 MCP] 读取参考图失败: ${rawPath}`, error)
    }
  }
  return result
}

// ===== 下载图片为 base64 =====

async function downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string; ext: string } | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`[GPT Image 2 MCP] 下载图片失败 (${response.status}): ${url}`)
      return null
    }
    const contentType = response.headers.get('content-type') || 'image/png'
    const arrayBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    let ext = '.png'
    if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = '.jpg'
    else if (contentType.includes('webp')) ext = '.webp'
    try {
      const urlExt = extname(new URL(url).pathname).toLowerCase()
      if (urlExt === '.jpg' || urlExt === '.jpeg') ext = '.jpg'
      else if (urlExt === '.png') ext = '.png'
      else if (urlExt === '.webp') ext = '.webp'
    } catch {
      /* ignore */
    }

    return {
      base64,
      mimeType: contentType.split(';')[0]?.trim() || 'image/png',
      ext,
    }
  } catch (error) {
    console.error(`[GPT Image 2 MCP] 下载图片异常: ${url}`, error)
    return null
  }
}

// ===== Edit 模式支持的 size 白名单 =====
// 上游 /v3/gpt-image-2-edit 只支持这三种尺寸，不支持 2K/4K/auto
const EDIT_SUPPORTED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024'])

async function callGptImage2AndBuildResult(
  prompt: string,
  sessionId: string,
  options: {
    size?: string
    quality?: string
    numberOfImages?: number
    background?: string
    referenceImagePaths?: string[]
    cwd?: string
  },
): Promise<McpToolResult> {
  const token = getAuthToken()
  if (!token) {
    return { content: [{ type: 'text' as const, text: '云端生图失败：未登录' }] }
  }

  // 截断参考图数量：默认上限 3 张，防止模型误传过多历史图
  const MAX_REFERENCE_IMAGES = 3
  const truncatedPaths = options.referenceImagePaths?.slice(0, MAX_REFERENCE_IMAGES)
  if (options.referenceImagePaths && options.referenceImagePaths.length > MAX_REFERENCE_IMAGES) {
    console.warn(
      `[GPT Image 2 MCP] 参考图数量 ${options.referenceImagePaths.length} 超过上限 ${MAX_REFERENCE_IMAGES}，已截断为最前 ${MAX_REFERENCE_IMAGES} 张`,
    )
  }

  const refDataUrls = truncatedPaths?.length
    ? readReferenceImagesAsDataUrl(truncatedPaths, options.cwd)
    : []

  const isEditMode = refDataUrls.length > 0

  // Edit 模式的 size 强制校验：上游编辑端点只支持 3 种尺寸，不支持 2K/4K/auto
  let resolvedSize = options.size || '1024x1024'
  if (isEditMode && !EDIT_SUPPORTED_SIZES.has(resolvedSize)) {
    console.warn(`[GPT Image 2 MCP] Edit 模式不支持 size="${resolvedSize}"，已降级为 1024x1024`)
    resolvedSize = '1024x1024'
  }

  const body: Record<string, unknown> = {
    prompt,
    size: resolvedSize,
    quality: options.quality || 'medium',
    n: options.numberOfImages || 1,
  }
  if (options.background) body.background = options.background
  if (refDataUrls.length > 0) {
    body.image = refDataUrls.length === 1 ? refDataUrls[0] : refDataUrls
  }

  const { baseUrl } = getCloudApiConfig()
  console.log(`[GPT Image 2 MCP] 云端调用: edit=${refDataUrls.length > 0}, size=${body.size}, quality=${body.quality}`)

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
    console.error(`[GPT Image 2 MCP] 云端请求失败 (${response.status}):`, errorText)
    return {
      content: [{ type: 'text' as const, text: `图片生成失败 (${response.status}): ${errorText.slice(0, 200)}` }],
    }
  }

  const data = await response.json() as GptImage2Response
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : (data.error.message ?? 'unknown')
    return { content: [{ type: 'text' as const, text: `GPT Image 2 错误: ${msg}` }] }
  }

  const urls = data.images ?? []
  if (urls.length === 0) {
    return { content: [{ type: 'text' as const, text: '未生成任何图片' }] }
  }

  const mcpContent: McpContent[] = []
  const textParts: string[] = []
  const savedWorkspacePaths: string[] = []

  for (const url of urls) {
    const downloaded = await downloadImageAsBase64(url)
    if (!downloaded) continue
    const { base64, mimeType, ext } = downloaded
    const filename = `gpt-image-2-${randomUUID().slice(0, 8)}${ext}`

    // 保存到附件目录
    const result = saveAttachment({
      conversationId: sessionId,
      filename,
      mediaType: mimeType,
      data: base64,
    })

    // 同时保存到 Agent 工作目录
    if (options.cwd) {
      try {
        const imgDir = join(options.cwd, 'generated-images')
        mkdirSync(imgDir, { recursive: true })
        const workspacePath = join(imgDir, filename)
        writeFileSync(workspacePath, Buffer.from(base64, 'base64'))
        savedWorkspacePaths.push(workspacePath)
      } catch (err) {
        console.warn(`[GPT Image 2 MCP] 保存图片到工作目录失败:`, err)
      }
    }

    // MCP image content（供模型查看）
    mcpContent.push({
      type: 'image' as const,
      data: base64,
      mimeType,
    })

    // 嵌入附件标记（供前端解析渲染）
    const attachmentMeta = JSON.stringify({
      localPath: result.attachment.localPath,
      filename: result.attachment.filename,
      mediaType: result.attachment.mediaType,
    })
    textParts.push(`[PROMA_IMAGE_ATTACHMENT:${attachmentMeta}]`)
  }

  const imageCount = mcpContent.filter((c) => c.type === 'image').length
  const pathInfo = savedWorkspacePaths.length > 0
    ? `\n图片已保存到工作目录:\n${savedWorkspacePaths.map((p) => `- ${p}`).join('\n')}`
    : ''
  const summaryText = imageCount > 0
    ? `图片已生成（${imageCount} 张）${pathInfo}\n${textParts.join('\n')}`
    : '未生成图片内容'

  mcpContent.push({ type: 'text' as const, text: summaryText })
  return { content: mcpContent }
}

// ===== MCP Server 注入 =====

export async function injectGptImage2McpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  sessionId: string,
  agentCwd?: string,
): Promise<void> {
  const toolState = getToolState('gpt-image-2')
  const credentials = getToolCredentials('gpt-image-2')
  const isCloud = credentials.cloudMode === 'true' && credentials.useCloud !== 'false'
  if (!toolState.enabled || !isCloud) return

  const { z } = await import('zod')

  const server = sdk.createSdkMcpServer({
    name: 'gpt-image-2',
    version: '1.0.0',
    tools: [
      sdk.tool(
        'generate_image_gpt',
        `Generate or edit images using GPT Image 2.

MODES:
- Text-to-image (no referenceImagePaths): Uses /v3/gpt-image-2-text-to-image. Supports all sizes including 2K/4K/auto.
- Edit (with referenceImagePaths): Uses /v3/gpt-image-2-edit. ONLY supports 1024x1024/1024x1536/1536x1024 — never pass 2K/4K/auto in edit mode.

SELECTING REFERENCE IMAGES (when user asks to edit/modify/adjust):
1. Candidate sources in the working directory:
   - User-uploaded images listed in <attached_files> or referenced via @file:{path}
   - Previously generated images under ./generated-images/ (you'll see the exact paths in prior tool results)
2. You MAY proactively use the Read tool on candidate image files to visually inspect them before deciding which ones best match the user's intent. Read supports PNG/JPG/WebP and returns the image for you to see.
3. Pass up to 3 of the most relevant reference image paths in referenceImagePaths (absolute or relative to cwd). Prefer the most recent/relevant ones; do NOT blindly pass every image you've ever generated.
4. For simple "continue editing the last image" requests, the single most recent generated image is usually sufficient.`,
        {
          prompt: z.string().describe('Detailed description of the image to generate or the edits to make. Up to 32000 chars; English works best.'),
          referenceImagePaths: z.array(z.string()).max(3).optional().describe('Up to 3 reference image paths for editing (absolute or relative to cwd). Use the Read tool first if you want to visually inspect candidates before choosing. Pass the most relevant recent images only — not every image in history.'),
          size: z.enum(['1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto']).optional().describe('Image size. For text-to-image: all values supported. For edit mode (referenceImagePaths set): ONLY 1024x1024/1024x1536/1536x1024. Default 1024x1024.'),
          quality: z.enum(['low', 'medium', 'high']).optional().describe('Generation quality. Default is "medium". Only use "high" when the user explicitly requests best/high quality. Only use "low" when the user explicitly requests fast/cheap/draft. If the user does not mention quality, always use "medium".'),
          numberOfImages: z.number().int().min(1).max(10).optional().describe('Number of images to generate (1-10, default 1).'),
          background: z.enum(['transparent', 'opaque', 'auto']).optional().describe('Background handling.'),
        },
        async (args) => {
          try {
            return await callGptImage2AndBuildResult(args.prompt, sessionId, {
              size: args.size,
              quality: args.quality || 'medium',
              numberOfImages: args.numberOfImages,
              background: args.background,
              referenceImagePaths: args.referenceImagePaths,
              cwd: agentCwd,
            })
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error(`[GPT Image 2 MCP] 执行失败:`, error)
            return { content: [{ type: 'text' as const, text: `图片生成失败: ${msg}` }] }
          }
        },
      ),
    ],
  })

  mcpServers['gpt-image-2'] = server as unknown as Record<string, unknown>
  console.log(`[GPT Image 2 MCP] 已注入内置生图工具 (gpt-image-2)`)
}
