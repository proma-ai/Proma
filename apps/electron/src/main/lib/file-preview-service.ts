/**
 * 文件预览服务 — 在新 Electron 窗口中预览文件
 *
 * 支持预览类型：
 * - 图片 (png, jpg, gif, webp, svg, bmp)
 * - 视频 (mp4, webm, mov)
 * - Markdown (md)
 * - JSON (json)
 * - XML/HTML (xml, html, htm)
 * - PDF (pdf) — 使用 Chromium 原生 PDF 查看器
 * - DOCX (docx) — 使用 mammoth.js 转 HTML
 * - 其他类型自动调用系统默认应用打开
 *
 * 所有预览窗口自动跟随系统主题（light/dark）。
 */

import { BrowserWindow, shell, nativeTheme } from 'electron'
import { resolve, basename, extname, join } from 'node:path'
import { readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

/** 文件大小限制：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 支持预览的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

/** 支持预览的视频扩展名 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])

/** 支持代码高亮预览的扩展名 */
const CODE_EXTENSIONS = new Set(['.json', '.xml', '.html', '.htm'])

/** 支持 Markdown 渲染预览的扩展名 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

/** 支持 PDF 预览的扩展名 */
const PDF_EXTENSIONS = new Set(['.pdf'])

/** 支持 DOCX 预览的扩展名 */
const DOCX_EXTENSIONS = new Set(['.docx'])

/** 获取预览类型 */
function getPreviewType(ext: string): 'image' | 'video' | 'markdown' | 'code' | 'pdf' | 'docx' | 'unsupported' {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (DOCX_EXTENSIONS.has(ext)) return 'docx'
  return 'unsupported'
}

/** 转义 HTML 特殊字符 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 获取临时文件目录 */
function getPreviewTmpDir(): string {
  const dir = join(tmpdir(), 'proma-preview')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 将 HTML 写入临时文件并返回路径 */
function writeTempHtml(html: string): string {
  const tmpDir = getPreviewTmpDir()
  const tmpFile = join(tmpDir, `preview-${Date.now()}.html`)
  writeFileSync(tmpFile, html, 'utf-8')
  return tmpFile
}

/** 生成支持 light/dark 主题的通用页面样式 */
function baseStyles(): string {
  return `
    :root {
      color-scheme: light dark;
      --bg: #ffffff;
      --bg-toolbar: #f5f5f5;
      --border: #e0e0e0;
      --text: #1a1a1a;
      --text-secondary: #666;
      --text-muted: #999;
      --btn-bg: #eee;
      --btn-border: #ccc;
      --btn-hover: #ddd;
      --code-bg: #f4f4f4;
      --content-bg: #fafafa;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a1a;
        --bg-toolbar: #252525;
        --border: #333;
        --text: #e0e0e0;
        --text-secondary: #ccc;
        --text-muted: #888;
        --btn-bg: #333;
        --btn-border: #444;
        --btn-hover: #444;
        --code-bg: #2d2d2d;
        --content-bg: #1a1a1a;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: var(--bg-toolbar);
      border-bottom: 1px solid var(--border);
      -webkit-app-region: drag;
      flex-shrink: 0;
    }
    .toolbar-title {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toolbar-path {
      font-size: 11px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }
    .toolbar-btn {
      -webkit-app-region: no-drag;
      padding: 5px 12px;
      border: 1px solid var(--btn-border);
      border-radius: 6px;
      background: var(--btn-bg);
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .toolbar-btn:hover { background: var(--btn-hover); }
    .content {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--content-bg);
    }
  `
}

/** 生成工具栏 HTML */
function toolbarHtml(filePath: string, filename: string): string {
  return `
  <div class="toolbar">
    <div style="flex:1">
      <div class="toolbar-title">${escapeHtml(filename)}</div>
      <div class="toolbar-path">${escapeHtml(filePath)}</div>
    </div>
    <button class="toolbar-btn" id="btn-open">用默认应用打开</button>
    <button class="toolbar-btn" id="btn-finder">在 Finder 中显示</button>
  </div>`
}

/** 生成工具栏按钮脚本 */
function toolbarScript(filePath: string): string {
  return `
  <script>
    const filePath = ${JSON.stringify(filePath)};
    document.getElementById('btn-open').onclick = () => {
      document.title = '__preview_action__:open:' + filePath;
    };
    document.getElementById('btn-finder').onclick = () => {
      document.title = '__preview_action__:folder:' + filePath;
    };
  </script>`
}

/** 生成图片预览 HTML */
function imagePreviewHtml(filePath: string, filename: string): string {
  const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content { background: var(--content-bg); }
  .content img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style></head><body>
  ${toolbarHtml(filePath, filename)}
  <div class="content">
    <img src="${fileUrl}" alt="${escapeHtml(filename)}" />
  </div>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成视频预览 HTML */
function videoPreviewHtml(filePath: string, filename: string): string {
  const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content video {
    max-width: 100%;
    max-height: 100%;
  }
</style></head><body>
  ${toolbarHtml(filePath, filename)}
  <div class="content">
    <video src="${fileUrl}" controls autoplay style="outline:none"></video>
  </div>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成 Markdown 预览 HTML */
function markdownPreviewHtml(filePath: string, filename: string, textContent: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: block;
    padding: 24px 32px;
    align-items: stretch;
    overflow-y: auto;
  }
  .markdown-body {
    max-width: 800px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
  }
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin: 1em 0 0.5em; }
  .markdown-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  .markdown-body h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
  .markdown-body h3 { font-size: 1.15em; }
  .markdown-body p { margin: 0.8em 0; }
  .markdown-body code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: 'SF Mono', Monaco, Menlo, monospace;
  }
  .markdown-body pre {
    background: var(--code-bg);
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 1em 0;
  }
  .markdown-body pre code { background: none; padding: 0; }
  .markdown-body blockquote {
    border-left: 3px solid var(--border);
    padding-left: 12px;
    color: var(--text-muted);
    margin: 1em 0;
  }
  .markdown-body ul, .markdown-body ol { padding-left: 2em; margin: 0.5em 0; }
  .markdown-body li { margin: 0.3em 0; }
  .markdown-body a { color: #2563eb; text-decoration: none; }
  @media (prefers-color-scheme: dark) { .markdown-body a { color: #58a6ff; } }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  .markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  .markdown-body th { background: var(--code-bg); }
  .markdown-body img { max-width: 100%; border-radius: 8px; }
  .markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
</style></head><body>
  ${toolbarHtml(filePath, filename)}
  <div class="content">
    <div class="markdown-body" id="md-content"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
  <script>
    const raw = ${JSON.stringify(textContent)};
    document.getElementById('md-content').innerHTML = typeof marked !== 'undefined'
      ? marked.parse(raw)
      : '<pre>' + raw.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成代码/文本预览 HTML */
function codePreviewHtml(filePath: string, filename: string, textContent: string, ext: string): string {
  const langMap: Record<string, string> = {
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.htm': 'html',
  }
  const lang = langMap[ext] || 'text'
  const isDark = nativeTheme.shouldUseDarkColors

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: block;
    padding: 0;
    align-items: stretch;
    overflow: auto;
  }
  pre {
    padding: 16px 20px;
    font-family: 'SF Mono', Monaco, Menlo, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-all;
    tab-size: 2;
    width: 100%;
  }
</style>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/${isDark ? 'github-dark' : 'github'}.min.css">
</head><body>
  ${toolbarHtml(filePath, filename)}
  <div class="content">
    <pre><code class="language-${lang}" id="code-content">${escapeHtml(textContent)}</code></pre>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js"></script>
  <script>
    if (typeof hljs !== 'undefined') {
      hljs.highlightElement(document.getElementById('code-content'));
    }
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成 PDF 预览 HTML（使用 PDF.js 渲染，兼容性优于 Chromium 内置查看器） */
function pdfPreviewHtml(filePath: string, filename: string): string {
  const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: auto;
    padding: 16px;
    gap: 12px;
    background: var(--content-bg);
  }
  canvas {
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    max-width: 100%;
  }
  .page-info {
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
    padding: 4px 0;
  }
  .loading-msg {
    text-align: center;
    color: var(--text-muted);
    padding: 40px;
  }
  .error-msg {
    color: #f87171;
    padding: 20px;
    text-align: center;
  }
</style>
</head><body>
  ${toolbarHtml(filePath, filename)}
  <div class="content" id="pdf-container">
    <div class="loading-msg">正在加载 PDF...</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs" type="module"></script>
  <script type="module">
    import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs';
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';

    const container = document.getElementById('pdf-container');
    const fileUrl = ${JSON.stringify(fileUrl)};

    async function renderPDF() {
      try {
        const pdf = await pdfjsLib.getDocument(fileUrl).promise;
        container.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          // 使用 2x 缩放以获得清晰渲染
          const scale = 2;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // 显示宽度为实际宽度的一半（Retina 清晰度）
          canvas.style.width = (viewport.width / scale) + 'px';
          canvas.style.height = (viewport.height / scale) + 'px';

          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;

          container.appendChild(canvas);
        }

        // 页数信息
        const info = document.createElement('div');
        info.className = 'page-info';
        info.textContent = '共 ' + pdf.numPages + ' 页';
        container.appendChild(info);
      } catch (err) {
        container.innerHTML = '<div class="error-msg">PDF 加载失败: ' + err.message + '</div>';
      }
    }

    renderPDF();
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成 DOCX 预览 HTML（使用 mammoth.js 转换为 HTML） */
function docxPreviewHtml(filePath: string, filename: string, base64Data: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: block;
    padding: 24px 32px;
    align-items: stretch;
    overflow-y: auto;
  }
  .docx-body {
    max-width: 800px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
  }
  .docx-body h1, .docx-body h2, .docx-body h3 { margin: 1em 0 0.5em; }
  .docx-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  .docx-body h2 { font-size: 1.4em; }
  .docx-body h3 { font-size: 1.15em; }
  .docx-body p { margin: 0.8em 0; }
  .docx-body table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  .docx-body th, .docx-body td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  .docx-body th { background: var(--code-bg); }
  .docx-body img { max-width: 100%; border-radius: 8px; }
  .docx-body ul, .docx-body ol { padding-left: 2em; margin: 0.5em 0; }
  .docx-body li { margin: 0.3em 0; }
  .docx-body a { color: #2563eb; }
  @media (prefers-color-scheme: dark) { .docx-body a { color: #58a6ff; } }
  .loading { text-align: center; color: var(--text-muted); padding: 40px; }
  .error { color: #f87171; padding: 20px; }
</style></head><body>
  ${toolbarHtml(filePath, filename)}
  <div class="content">
    <div class="docx-body" id="docx-content">
      <div class="loading">正在解析文档...</div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/mammoth@1/mammoth.browser.min.js"></script>
  <script>
    const base64 = ${JSON.stringify(base64Data)};
    const container = document.getElementById('docx-content');

    function base64ToArrayBuffer(b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    if (typeof mammoth !== 'undefined') {
      mammoth.convertToHtml({ arrayBuffer: base64ToArrayBuffer(base64) })
        .then(function(result) {
          container.innerHTML = result.value;
        })
        .catch(function(err) {
          container.innerHTML = '<div class="error">文档解析失败: ' + err.message + '</div>';
        });
    } else {
      container.innerHTML = '<div class="error">mammoth.js 加载失败，请检查网络连接</div>';
    }
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 创建预览窗口并绑定工具栏事件 */
function createPreviewWindow(filename: string): BrowserWindow {
  const previewWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: filename,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  previewWindow.setMenuBarVisibility(false)

  // 监听 title 变化来处理工具栏按钮操作
  previewWindow.on('page-title-updated', (event, title) => {
    if (title.startsWith('__preview_action__:')) {
      event.preventDefault()
      const [, action] = title.split(':')
      const fullPath = title.slice(`__preview_action__:${action}:`.length)

      if (action === 'open') {
        shell.openPath(fullPath)
      } else if (action === 'folder') {
        shell.showItemInFolder(fullPath)
      }

      previewWindow.setTitle(filename)
    }
  })

  return previewWindow
}

/**
 * 在新窗口中预览文件
 * 不支持的文件类型会调用系统默认应用打开
 */
export function openFilePreview(filePath: string): void {
  const safePath = resolve(filePath)
  const filename = basename(safePath)
  const ext = extname(safePath).toLowerCase()
  const previewType = getPreviewType(ext)

  // 不支持的类型，直接用系统默认应用打开
  if (previewType === 'unsupported') {
    shell.openPath(safePath)
    return
  }

  // 检查文件大小
  const stat = statSync(safePath)
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(`[文件预览] 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，使用系统应用打开`)
    shell.openPath(safePath)
    return
  }

  let html: string

  if (previewType === 'pdf') {
    html = pdfPreviewHtml(safePath, filename)
  } else if (previewType === 'image') {
    html = imagePreviewHtml(safePath, filename)
  } else if (previewType === 'video') {
    html = videoPreviewHtml(safePath, filename)
  } else if (previewType === 'docx') {
    const buffer = readFileSync(safePath)
    const base64 = buffer.toString('base64')
    html = docxPreviewHtml(safePath, filename, base64)
  } else {
    const textContent = readFileSync(safePath, 'utf-8')
    html = previewType === 'markdown'
      ? markdownPreviewHtml(safePath, filename, textContent)
      : codePreviewHtml(safePath, filename, textContent, ext)
  }

  // 将 HTML 写入临时文件（避免 data: URL 大小限制）
  const tmpHtmlPath = writeTempHtml(html)
  const previewWindow = createPreviewWindow(filename)
  previewWindow.loadFile(tmpHtmlPath)
}
