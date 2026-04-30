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

// ===== 调用上游并构建 MCP 结果 =====

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

  const refDataUrls = options.referenceImagePaths?.length
    ? readReferenceImagesAsDataUrl(options.referenceImagePaths, options.cwd)
    : []

  const body: Record<string, unknown> = {
    prompt,
    size: options.size || '1024x1024',
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
        'Generate or edit images using GPT Image 2. Supports text-to-image generation and reference-image editing. Pass referenceImagePaths (absolute or relative to cwd) to invoke the edit endpoint with the given image(s). When the user uploads images (listed in <attached_files>) or mentions image files via @file:{path}, pass their paths via referenceImagePaths.',
        {
          prompt: z.string().describe('Detailed description of the image to generate or the edits to make. Up to 32000 chars; English works best.'),
          referenceImagePaths: z.array(z.string()).optional().describe('File paths of reference images for editing.'),
          size: z.enum(['1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto']).optional().describe('Image size. 1024x1024=square, 1024x1536=portrait, 1536x1024=landscape, 2048x2048=2K square, 2048x1152=2K landscape, 3840x2160=4K landscape, 2160x3840=4K portrait, auto=let model decide. Default 1024x1024.'),
          quality: z.enum(['low', 'medium', 'high']).optional().describe('Generation quality (default medium).'),
          numberOfImages: z.number().int().min(1).max(10).optional().describe('Number of images to generate (1-10, default 1).'),
          background: z.enum(['transparent', 'opaque', 'auto']).optional().describe('Background handling.'),
        },
        async (args) => {
          try {
            return await callGptImage2AndBuildResult(args.prompt, sessionId, {
              size: args.size,
              quality: args.quality,
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
