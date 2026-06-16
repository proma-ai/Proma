/**
 * chat-screenshot — 基于消息内容生成截图
 *
 * 从消息元素中提取内容体（文字/代码/图片），
 * 嵌入精简排版 CSS 生成清爽的自包含截图。
 * Shiki 代码高亮通过内联 style 保留，无需外部 CSS。
 * Chat 和 Agent 模式共享。
 */

import { SCREENSHOT_LIMITS } from '@proma/shared'

/** 截图精简排版 CSS（自包含，不依赖 Tailwind） */
const SCREENSHOT_CLEAN_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:15px}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65;padding:40px 48px;max-width:800px;margin:0 auto;color:#1f2937;background:#fff}
body.dark{color:#e5e7eb;background:#111827}
.msg{margin-bottom:32px}
.msg-head{font-size:13px;margin-bottom:10px;display:flex;gap:8px;align-items:baseline}
.msg-role{font-weight:600}
.msg-time{color:#9ca3af}.dark .msg-time{color:#6b7280}
.msg-body{word-break:break-word}
.msg-body p{margin:0 0 12px}.msg-body p:last-child{margin-bottom:0}
.msg-body p:empty{display:none}
.msg-body ul,.msg-body ol{padding-left:24px;margin:8px 0}
.msg-body li{margin:4px 0}
.msg-body pre{margin:12px 0;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.5;background:#f3f4f6}
.dark .msg-body pre{background:#1f2937}
.msg-body code{font-size:0.9em}
.msg-body pre code{font-size:13px;background:0;padding:0}
.msg-body img{max-width:100%;height:auto;border-radius:8px;margin:8px 0}
.msg-body table{border-collapse:collapse;width:100%;margin:12px 0}
.msg-body td,.msg-body th{border:1px solid #d1d5db;padding:8px 12px;text-align:left}
.dark .msg-body td,.dark .msg-body th{border-color:#374151}
.msg-body th{background:#f9fafb;font-weight:600}.dark .msg-body th{background:#1f2937}
.msg-body blockquote{border-left:3px solid #e5e7eb;padding-left:16px;margin:12px 0;color:#6b7280}
.dark .msg-body blockquote{border-color:#374151;color:#9ca3af}
.msg-body hr{border:none;border-top:1px solid #e5e7eb;margin:16px 0}.dark .msg-body hr{border-color:#374151}
.msg-body h1,.msg-body h2,.msg-body h3,.msg-body h4{font-weight:600;margin:16px 0 8px;line-height:1.3}
.msg-body h1{font-size:1.4em}.msg-body h2{font-size:1.2em}.msg-body h3{font-size:1.1em}
.msg-body [style*="color:"]{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Cascadia Code','JetBrains Mono','Fira Code',Consolas,monospace}
`

/** 消息角色 → 显示名 */
function roleLabel(role: string): string {
  if (role === 'user') return 'You'
  if (role === 'assistant') return 'Assistant'
  return role
}

export interface ScreenshotResult {
  success: boolean
  error?: string
}

/**
 * 从 clone 中提取消息内容体 HTML。
 * 移除交互元素和 UI 外壳，保留正文 + 代码 + 图片。
 */
function extractContentBody(clone: HTMLElement): string {
  // 1. 移除明确的交互元素和标记
  clone.querySelectorAll(`
    button, [role="button"], input, textarea, select,
    [data-no-screenshot]
  `).forEach((c) => { (c as HTMLElement).remove() })

  // 2. 移除因按钮被删而变空的容器（如 MessageActions）
  //    多轮清理：深层容器清空后，外层容器也可能变空
  for (let i = 0; i < 3; i++) {
    clone.querySelectorAll('div').forEach((div) => {
      const el = div as HTMLElement
      // 有可见子元素（非空白文本）则不删
      if (el.children.length > 0) return
      if (el.textContent && el.textContent.trim()) return
      el.remove()
    })
  }

  return clone.innerHTML
}

/**
 * 判定消息角色
 */
function detectRole(el: HTMLElement): string {
  const msgRole = el.getAttribute('data-message-role')
  if (msgRole === 'user' || msgRole === 'assistant') return msgRole
  if (el.querySelector('.is-user')) return 'user'
  if (el.querySelector('.is-assistant')) return 'assistant'
  return 'assistant'
}

/**
 * 提取消息时间
 */
function extractTime(clone: HTMLElement): string {
  const timeEl = clone.querySelector('[class*="text-[10px]"], [class*="text-foreground/"] time, time')
  return timeEl?.textContent?.trim() || ''
}

/**
 * 从选中的消息 ID 生成截图
 *
 * @param selectedIds - 选中的消息 data-message-id 集合
 * @param mode - 输出方式：clipboard 复制到剪贴板 / file 保存为文件
 */
export async function captureSelectedMessages(
  selectedIds: Set<string>,
  mode: 'clipboard' | 'file',
): Promise<ScreenshotResult> {
  if (selectedIds.size === 0) {
    return { success: false, error: '未选择任何消息' }
  }

  const allMessageEls = Array.from(document.querySelectorAll('[data-message-id]'))

  if (allMessageEls.length === 0) {
    return { success: false, error: '页面尚未加载消息，请稍后重试' }
  }

  // 构建内容文章
  const articles: string[] = []
  const seen = new Set<string>()

  for (const el of allMessageEls) {
    const id = el.getAttribute('data-message-id')
    if (!id || !selectedIds.has(id) || seen.has(id)) continue
    seen.add(id)

    const clone = el.cloneNode(true) as HTMLElement
    const role = detectRole(clone)
    const time = extractTime(clone)
    const bodyHtml = extractContentBody(clone)

    if (!bodyHtml.trim()) continue

    articles.push(`<article class="msg">
  <div class="msg-head"><span class="msg-role">${roleLabel(role)}</span>${time ? ` <span class="msg-time">${time}</span>` : ''}</div>
  <div class="msg-body">${bodyHtml}</div>
</article>`)
  }

  if (articles.length === 0) {
    return { success: false, error: '未找到选中消息的 DOM 元素' }
  }

  const isDark = document.documentElement.classList.contains('dark')
  const html = articles.join('\n')

  const htmlBytes = new TextEncoder().encode(html).length
  if (htmlBytes > SCREENSHOT_LIMITS.MAX_RAW_HTML_BYTES) {
    return { success: false, error: '选中内容过多，请减少选择后重试' }
  }

  try {
    await window.electronAPI.screenshotCapture({
      html,
      isDark,
      width: 800,
      mode,
      css: SCREENSHOT_CLEAN_CSS,
      themeClass: isDark ? 'dark' : '',
    })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '截图失败',
    }
  }
}
