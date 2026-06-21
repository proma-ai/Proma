/**
 * message-screenshot — 消息截图载荷构建工具
 *
 * 复刻自 MarkdownEditorToolbar.tsx 的 buildScreenshotPayload 模式：
 * 克隆消息 DOM + 收集运行时 CSS → 走现有 IPC 截图管线。
 *
 * 避免了自建截图引擎的并行渲染路径维护问题——截图侧用的就是
 * 渲染侧的真实 CSS（含 Tailwind 编译输出 + globals.css 变量），
 * 与页面样式 100% 一致。
 */

import { SCREENSHOT_LIMITS } from '@proma/shared'
import { toast } from 'sonner'

export interface MessageScreenshotPayload {
  html: string
  width: number
  css: string
  themeClass: string
}

/**
 * 收集渲染端已编译的运行时 CSS（含 Tailwind 输出 + globals.css）。
 * 跨域 sheet 读 cssRules 会抛，捕获后跳过。
 */
function collectRuntimeStyles(): string {
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules
      if (!rules) continue
      for (const rule of Array.from(rules)) {
        chunks.push(rule.cssText)
      }
    } catch {
      // 跨域 sheet 跳过
    }
  }
  return chunks.join('\n')
}

/**
 * 从消息 DOM 元素构建截图载荷。
 * 遵循与 MarkdownEditorToolbar 相同的预检→克隆→收集流程。
 *
 * @param messageEl - 消息根元素的 HTMLElement（<Message> 容器）
 * @param contentWidth - 可选的内容宽度覆盖，默认从元素测量
 * @returns 适用于 window.electronAPI.screenshotCapture 的载荷
 */
export function buildMessageScreenshotPayload(
  messageEl: HTMLElement,
  contentWidth?: number,
): MessageScreenshotPayload {
  // 预检：早失败
  const elementCount = messageEl.querySelectorAll('*').length
  if (elementCount > SCREENSHOT_LIMITS.MAX_ELEMENTS) {
    throw new Error('消息结构过于复杂，请简化后重试')
  }
  if (messageEl.outerHTML.length > SCREENSHOT_LIMITS.MAX_RAW_HTML_BYTES) {
    throw new Error('消息过大，请缩短后重试')
  }

  // 克隆 DOM
  const clone = messageEl.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[contenteditable]').forEach((el) => {
    el.removeAttribute('contenteditable')
  })

  const rect = messageEl.getBoundingClientRect()
  const width = Math.max(
    SCREENSHOT_LIMITS.MIN_WIDTH,
    Math.min(
      SCREENSHOT_LIMITS.MAX_WIDTH,
      Math.ceil(contentWidth ?? (rect.width || 680)),
    ),
  )
  clone.style.width = `${width}px`

  return {
    html: clone.outerHTML,
    width,
    css: collectRuntimeStyles(),
    themeClass: document.documentElement.className,
  }
}

/**
 * 截图消息元素并复制到剪贴板。
 * 封装了 IPC 调用 + toast 反馈，组件中只需一行调用。
 *
 * @param el - 消息根元素
 * @returns 是否成功
 */
export async function captureMessageScreenshot(el: HTMLElement): Promise<boolean> {
  try {
    const payload = buildMessageScreenshotPayload(el)
    const result = await window.electronAPI.screenshotCapture({
      ...payload,
      isDark: document.documentElement.classList.contains('dark'),
      mode: 'clipboard',
    })
    if (result.success) {
      toast.success(result.message || '截图已复制到剪贴板')
    } else {
      toast.error(result.message || '截图失败')
    }
    return result.success
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '截图失败')
    return false
  }
}

/**
 * 多消息截图：选中 N 条消息，拼接 HTML 后一次 IPC 渲染。
 *
 * @param els - 选中的消息 DOM 元素列表
 * @returns 是否成功
 */
export async function captureMultiMessageScreenshot(els: HTMLElement[]): Promise<boolean> {
  if (els.length === 0) return false

  try {
    const payloads = els.map((el) => buildMessageScreenshotPayload(el))
    const maxWidth = Math.max(...payloads.map((p) => p.width))
    const combinedHtml = payloads.map((p) => p.html).join('\n<hr style="margin:0;border:none;border-top:1px solid #e5e7eb" />\n')

    const first = payloads[0]!
    const result = await window.electronAPI.screenshotCapture({
      html: combinedHtml,
      isDark: document.documentElement.classList.contains('dark'),
      width: maxWidth,
      mode: 'clipboard',
      css: first.css,
      themeClass: first.themeClass,
    })
    if (result.success) {
      toast.success(`已截图 ${els.length} 条消息`)
    } else {
      toast.error(result.message || '截图失败')
    }
    return result.success
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '截图失败')
    return false
  }
}
