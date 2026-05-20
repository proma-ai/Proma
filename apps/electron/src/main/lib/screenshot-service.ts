/**
 * 截图导出服务
 *
 * 参考 bozeman 的离屏渲染管线：
 * 隐藏 BrowserWindow + offscreen + pathToFileURL 加载临时 HTML + capturePage 截图
 * 长文档通过 pngjs 拼接分段截图。
 */

import { BrowserWindow, clipboard, dialog, nativeImage, screen, type NativeImage } from 'electron'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { SCREENSHOT_LIMITS } from '@proma/shared'

const SCREENSHOT_SCALE_CANDIDATES = [4, 3, 2, 1.5, 1]
const SCREENSHOT_MAX_SEGMENT = 4000
const SCREENSHOT_SEGMENT_MARGIN = 96
const SCREENSHOT_RESOURCE_TIMEOUT_MS = 5000
/** 截图左右两侧的背景留白（单边） */
const SCREENSHOT_PADDING_X = 48
/** 截图顶部背景留白 */
const SCREENSHOT_PADDING_TOP = 24

/* ── 离屏窗口单例 ── */

/** 空闲多久后自动销毁离屏窗口，释放内存 */
const SCREENSHOT_IDLE_TTL_MS = 5 * 60 * 1000

let _screenshotWin: BrowserWindow | null = null
let _screenshotScale = 0
let _idleTimer: ReturnType<typeof setTimeout> | null = null
let _appQuitHookRegistered = false

function destroyScreenshotWindow(): void {
  if (_idleTimer) {
    clearTimeout(_idleTimer)
    _idleTimer = null
  }
  if (_screenshotWin && !_screenshotWin.isDestroyed()) {
    _screenshotWin.destroy()
  }
  _screenshotWin = null
  _screenshotScale = 0
}

function scheduleIdleDestroy(): void {
  if (_idleTimer) clearTimeout(_idleTimer)
  _idleTimer = setTimeout(destroyScreenshotWindow, SCREENSHOT_IDLE_TTL_MS)
}

function ensureAppQuitHook(): void {
  if (_appQuitHookRegistered) return
  _appQuitHookRegistered = true
  // 进程退出前清理离屏窗口，避免 BrowserWindow 残留。lazy require 避免与 main 启动顺序耦合。
  const { app } = require('electron') as typeof import('electron')
  app.on('before-quit', destroyScreenshotWindow)
}

function getScreenshotWindow(scale: number): BrowserWindow {
  ensureAppQuitHook()
  if (_idleTimer) {
    clearTimeout(_idleTimer)
    _idleTimer = null
  }
  if (_screenshotWin && !_screenshotWin.isDestroyed() && _screenshotScale === scale) return _screenshotWin
  if (_screenshotWin && !_screenshotWin.isDestroyed()) {
    _screenshotWin.destroy()
  }
  _screenshotScale = scale
  _screenshotWin = new BrowserWindow({
    width: 960,
    height: 100,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      offscreen: { deviceScaleFactor: scale } as unknown as boolean,
      // Electron >=28 运行时接受 offscreen 对象（含 deviceScaleFactor），
      // 但 TS 类型仅声明为 boolean。已在 Electron 39 验证。
      // 若升级 Electron 后截图全白/崩溃，优先检查此处。
    },
  })
  return _screenshotWin
}

/* ── 串行锁（防并发截图） ── */

let _lock: Promise<unknown> = Promise.resolve()

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let resolve: (value?: unknown) => void
  const prev = _lock
  _lock = new Promise((r) => { resolve = r })
  // prev 即便已 rejected（fn 自身的 try/catch 兜底下不应发生，但加固调用方意外抛错路径），
  // 也用 .catch 吞掉以确保后续锁能继续推进。
  return prev.catch(() => undefined).then(() => fn().finally(() => resolve!()))
}

/* ── 最大分段高度（参考屏幕工作区） ── */

function resolveMaxSegmentHeight(): number {
  try {
    const display = screen.getPrimaryDisplay()
    const h = display?.workArea?.height || display?.bounds?.height
    if (Number.isFinite(h) && h > 0) {
      return Math.max(1, Math.min(SCREENSHOT_MAX_SEGMENT, h - SCREENSHOT_SEGMENT_MARGIN))
    }
  } catch { /* 降级 */ }
  return SCREENSHOT_MAX_SEGMENT
}

function resolveScreenshotScale(width: number, height: number): number {
  for (const scale of SCREENSHOT_SCALE_CANDIDATES) {
    if (width * height * scale * scale <= SCREENSHOT_LIMITS.MAX_PIXELS) return scale
  }
  return 0
}

function assertScreenshotBudget(width: number, height: number, scale: number): void {
  const pixels = width * height * scale * scale
  if (!Number.isFinite(pixels) || pixels <= 0) {
    throw new Error('截图尺寸无效')
  }
  if (pixels > SCREENSHOT_LIMITS.MAX_PIXELS) {
    throw new Error('文档过长，当前截图会占用过多内存，请缩短内容后重试')
  }
}

function stitchScreenshotSegments(parts: PNG[]): Buffer {
  if (parts.length === 0) {
    throw new Error('没有捕获到截图分段')
  }

  const width = parts[0]?.width
  if (!width) {
    throw new Error('截图分段宽度无效')
  }

  let height = 0
  for (const part of parts) {
    if (part.width !== width) {
      throw new Error(`截图分段宽度不一致：期望 ${width}px，实际 ${part.width}px`)
    }
    height += part.height
  }

  const full = new PNG({ width, height })
  let yOffset = 0
  for (const part of parts) {
    part.data.copy(full.data, yOffset * width * 4)
    yOffset += part.height
  }

  return PNG.sync.write(full)
}

/* ── 构建截图 HTML ── */

function sanitizeScreenshotFragment(html: string): string {
  // 纵深防御：CSP (script-src 'none') 是主要安全保障，此处做额外清理。
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:iframe|object|embed|base|form)\b[\s\S]*?<\/(?:iframe|object|embed|base|form)>/gi, '')
    .replace(/<(?:iframe|object|embed|base|form)\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
}

function buildScreenshotHtml(htmlContent: string, isDark: boolean, css: string, themeClass: string): string {
  const bg = isDark ? '#111827' : '#ffffff'
  const safeHtml = sanitizeScreenshotFragment(htmlContent)
  // 防止 css 字符串中出现 `</style >` 等变体提前终止 style 块。
  const safeCss = css.replace(/<\/style\s*>/gi, '<\\/style>')
  const safeThemeClass = themeClass.replace(/["<>]/g, '')

  return `<!DOCTYPE html>
<html class="${safeThemeClass}"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob: proma-file: https: http:; media-src 'self' data: blob: proma-file: https: http:; font-src 'self' data: https: http:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>${safeCss}</style>
<style>
*{box-sizing:border-box}
html,body{margin:0;background:${bg};scrollbar-width:none;-ms-overflow-style:none}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}
body{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
img,video,canvas,svg{max-width:100%}
.proma-screenshot-wrapper{padding:${SCREENSHOT_PADDING_TOP}px ${SCREENSHOT_PADDING_X}px;background:${bg};width:max-content;max-width:100%;margin:0 auto}
.proma-screenshot-sheet{width:max-content;max-width:100%;margin:0 auto;background:${bg}}
.proma-screenshot-sheet [contenteditable],
.proma-screenshot-sheet [contenteditable="false"]{outline:none}
.proma-screenshot-sheet .ProseMirror-selectednode,
.proma-screenshot-sheet .selectedCell::after{display:none!important}
</style></head><body class="${safeThemeClass}">
<div class="proma-screenshot-wrapper">
<main class="proma-screenshot-sheet">${safeHtml}</main>
</div>
</body></html>`
}

/* ── 核心截图函数 ── */

async function loadScreenshotDocument(win: BrowserWindow, htmlPath: string, width: number): Promise<number> {
  win.setSize(width, 100)
  await win.loadURL(pathToFileURL(htmlPath).href)
  await win.webContents.executeJavaScript(`
    (() => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForFonts = document.fonts?.ready?.catch(() => undefined) ?? Promise.resolve();
      const waitForImages = Promise.allSettled(Array.from(document.images).map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        if (typeof img.decode === 'function') return img.decode().catch(() => undefined);
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      }));
      return Promise.race([
        Promise.allSettled([waitForFonts, waitForImages]).then(() => true),
        sleep(${SCREENSHOT_RESOURCE_TIMEOUT_MS}).then(() => true),
      ]);
    })()
  `)
  await new Promise((r) => setTimeout(r, 100))
  const totalHeight: number = await win.webContents.executeJavaScript(`
      Math.max(document.body.scrollHeight, document.body.offsetHeight,
               document.documentElement.scrollHeight, document.documentElement.offsetHeight)
  `)
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) {
    throw new Error('截图内容高度无效')
  }
  return Math.ceil(totalHeight)
}

async function captureLoadedDocument(win: BrowserWindow, width: number, totalHeight: number, scale: number): Promise<Buffer> {
  assertScreenshotBudget(width, totalHeight, scale)

  const maxH = resolveMaxSegmentHeight()

  if (totalHeight <= maxH) {
    win.setSize(width, totalHeight)
    await new Promise((r) => setTimeout(r, 100))
    const image = await win.webContents.capturePage(
      { x: 0, y: 0, width, height: totalHeight },
    )
    return image.toPNG({ scaleFactor: scale })
  }

  // 分段截图（长文档）
  const parts: PNG[] = []
  let captured = 0
  while (captured < totalHeight) {
    const segH = Math.min(maxH, totalHeight - captured)
    win.setSize(width, segH)
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${captured})`)
    await new Promise((r) => setTimeout(r, 120))
    const seg: NativeImage = await win.webContents.capturePage(
      { x: 0, y: 0, width, height: segH },
    )
    parts.push(PNG.sync.read(seg.toPNG({ scaleFactor: scale })))
    captured += segH
  }

  return stitchScreenshotSegments(parts)
}

async function screenshotCapture(htmlContent: string, width: number): Promise<Buffer> {
  const tmpPath = join(tmpdir(), `proma-ss-${Date.now()}.html`)
  writeFileSync(tmpPath, htmlContent, 'utf-8')

  try {
    let win = getScreenshotWindow(1)
    let totalHeight = await loadScreenshotDocument(win, tmpPath, width)
    const scale = resolveScreenshotScale(width, totalHeight)
    if (!scale) {
      throw new Error('文档过长，当前截图会占用过多内存，请缩短内容后重试')
    }

    if (scale !== 1) {
      win = getScreenshotWindow(scale)
      totalHeight = await loadScreenshotDocument(win, tmpPath, width)
    }

    return captureLoadedDocument(win, width, totalHeight, scale)
  } finally {
    try { unlinkSync(tmpPath) } catch { /* 清理 */ }
  }
}

/* ── 公开接口 ── */

export interface ScreenshotInput {
  html: string
  isDark: boolean
  width?: number
  mode: 'clipboard' | 'file'
  /** 渲染端 document.styleSheets 收集到的运行时 CSS（含 Tailwind 编译输出） */
  css?: string
  /** 渲染端 documentElement.className（dark / theme-* 等），用于让基于主题 class 的 CSS 变量生效 */
  themeClass?: string
}

export interface ScreenshotResult {
  success: boolean
  message: string
  filePath?: string
}

export function captureScreenshot(input: ScreenshotInput): Promise<ScreenshotResult> {
  return withLock(async () => {
    try {
      const { html, isDark, width = 960, mode, css = '', themeClass = '' } = input
      if (typeof html !== 'string' || Buffer.byteLength(html, 'utf-8') > SCREENSHOT_LIMITS.MAX_HTML_BYTES) {
        throw new Error('截图内容过大')
      }
      if (typeof css !== 'string' || Buffer.byteLength(css, 'utf-8') > SCREENSHOT_LIMITS.MAX_HTML_BYTES) {
        throw new Error('截图样式过大')
      }
      if (!Number.isFinite(width)) {
        throw new Error('截图宽度无效')
      }
      if (mode !== 'clipboard' && mode !== 'file') {
        throw new Error('截图模式无效')
      }
      // 渲染端传入的是「内容宽度」，加上左右各 SCREENSHOT_PADDING_X 才是最终截图宽度。
      // gutter 是叠加在内容之外、而不是从内容里挤出来的——所以内容不会被压缩。
      const contentWidth = Math.max(SCREENSHOT_LIMITS.MIN_WIDTH, Math.min(SCREENSHOT_LIMITS.MAX_WIDTH, Math.ceil(width)))
      const safeWidth = contentWidth + SCREENSHOT_PADDING_X * 2
      const htmlContent = buildScreenshotHtml(html, isDark, css, themeClass)
      if (Buffer.byteLength(htmlContent, 'utf-8') > SCREENSHOT_LIMITS.MAX_HTML_BYTES) {
        throw new Error('截图内容和样式过大')
      }
      const pngBuffer = await screenshotCapture(htmlContent, safeWidth)

      if (mode === 'clipboard') {
        const img = nativeImage.createFromBuffer(pngBuffer)
        clipboard.writeImage(img)
        return { success: true, message: '截图已复制到剪贴板' }
      }

      const pad = (n: number) => String(n).padStart(2, '0')
      const now = new Date()
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '保存截图',
        defaultPath: join(homedir(), 'Desktop', `proma-${ts}.png`),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      })

      if (canceled || !filePath) {
        return { success: false, message: '已取消保存' }
      }

      writeFileSync(filePath, pngBuffer)
      return { success: true, message: '截图已保存', filePath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '截图失败'
      console.error('[截图服务]', err)
      return { success: false, message: msg }
    } finally {
      scheduleIdleDestroy()
    }
  })
}
