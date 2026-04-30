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

import { BrowserWindow, shell, nativeTheme, ipcMain, dialog, screen } from 'electron'
import { resolve, basename, extname, join, dirname } from 'node:path'
import {
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  watch as fsWatch,
  type FSWatcher,
} from 'node:fs'
import { tmpdir } from 'node:os'

/** 文件大小限制：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 支持预览的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

/** 支持预览的视频扩展名 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])

/** 支持代码/纯文本预览（含编辑）的扩展名 */
const CODE_EXTENSIONS = new Set([
  '.json', '.jsonc', '.json5',
  '.xml', '.html', '.htm', '.svg',
  '.txt', '.log', '.csv',
  '.yaml', '.yml', '.toml', '.ini', '.env', '.lock',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.fish',
  '.css', '.scss', '.less',
  '.sql', '.rb', '.php',
  '.diff', '.patch',
])

/** 支持 Markdown 渲染预览的扩展名 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

/**
 * 特殊文件名（无扩展名或扩展名不能代表语言）→ 高亮语言映射
 * 同时用于 highlight.js 和 Monaco（两者命名基本一致）
 */
const SPECIAL_FILENAME_LANG: Record<string, string> = {
  '.gitignore': 'bash',
  '.dockerignore': 'bash',
  '.npmignore': 'bash',
  '.eslintignore': 'bash',
  '.prettierignore': 'bash',
  '.gitattributes': 'bash',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.yarnrc': 'ini',
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'bun.lock': 'yaml',
  'pnpm-lock.yaml': 'yaml',
  'cargo.lock': 'ini',
  'gemfile': 'ruby',
  'rakefile': 'ruby',
  'procfile': 'yaml',
}

/** 扩展名 → Monaco / highlight.js 语言 ID 映射 */
const EXT_LANG_MAP: Record<string, string> = {
  '.md': 'markdown', '.markdown': 'markdown',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',
  '.xml': 'xml', '.html': 'html', '.htm': 'html', '.svg': 'xml',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini', '.ini': 'ini', '.env': 'bash', '.lock': 'yaml',
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cs': 'csharp',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.sql': 'sql', '.rb': 'ruby', '.php': 'php',
  '.diff': 'diff', '.patch': 'diff',
  '.txt': 'plaintext', '.log': 'plaintext', '.csv': 'plaintext',
}

/** 高亮库语言名映射（处理 highlight.js 与 Monaco 的命名差异） */
const HLJS_LANG_OVERRIDES: Record<string, string> = {
  shell: 'bash',
  html: 'xml',
  plaintext: 'plaintext',
}

/** 是否为可编辑文本类型 */
function isEditableType(previewType: string): boolean {
  return previewType === 'markdown' || previewType === 'code'
}

/** 通用语言 ID（用于 Monaco） */
function detectLanguage(filePath: string, ext: string): string {
  const base = basename(filePath).toLowerCase()
  if (isEnvFile(base)) return 'bash'
  if (SPECIAL_FILENAME_LANG[base]) return SPECIAL_FILENAME_LANG[base]
  return EXT_LANG_MAP[ext] || 'plaintext'
}

/** highlight.js 用的语言 ID（处理与 Monaco 的差异） */
function detectHljsLanguage(filePath: string, ext: string): string {
  const lang = detectLanguage(filePath, ext)
  return HLJS_LANG_OVERRIDES[lang] || lang
}

/** 预览窗口运行时状态 */
interface PreviewWindowState {
  filePath: string
  filename: string
  type: 'markdown' | 'code' | 'image' | 'video' | 'pdf' | 'docx'
  language: string
  initialContent: string
  isDirty: boolean
  watcher?: FSWatcher
  /** 标记主进程刚刚保存过文件，用于忽略由自身写入触发的 watcher 事件 */
  selfWriteAt: number
}

const previewStates = new Map<number, PreviewWindowState>()
let ipcRegistered = false

const PREVIEW_IPC = {
  GET_INITIAL: 'preview:get-initial',
  SAVE: 'preview:save',
  SET_DIRTY: 'preview:set-dirty',
  OPEN_EXTERNAL: 'preview:open-external',
  SHOW_IN_FOLDER: 'preview:show-in-folder',
  CLOSE: 'preview:close',
  ON_RELOAD: 'preview:on-reload',
  ON_EXTERNAL_CHANGED: 'preview:on-external-changed',
} as const

/** 仅注册一次 IPC 通道 */
function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle(PREVIEW_IPC.GET_INITIAL, (event) => {
    const state = previewStates.get(event.sender.id)
    if (!state) return null
    return {
      filePath: state.filePath,
      filename: state.filename,
      content: state.initialContent,
      language: state.language,
      isDark: nativeTheme.shouldUseDarkColors,
      type: state.type,
    }
  })

  ipcMain.handle(PREVIEW_IPC.SAVE, async (event, content: string) => {
    const state = previewStates.get(event.sender.id)
    if (!state) return { success: false, error: '窗口状态丢失' }
    try {
      atomicWriteFile(state.filePath, content)
      state.initialContent = content
      state.isDirty = false
      state.selfWriteAt = Date.now()
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.setTitle(state.filename)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.on(PREVIEW_IPC.SET_DIRTY, (event, dirty: boolean) => {
    const state = previewStates.get(event.sender.id)
    if (!state) return
    state.isDirty = !!dirty
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.setTitle((state.isDirty ? '● ' : '') + state.filename)
    }
  })

  ipcMain.on(PREVIEW_IPC.OPEN_EXTERNAL, (event) => {
    const state = previewStates.get(event.sender.id)
    if (state) shell.openPath(state.filePath)
  })

  ipcMain.on(PREVIEW_IPC.SHOW_IN_FOLDER, (event) => {
    const state = previewStates.get(event.sender.id)
    if (state) shell.showItemInFolder(state.filePath)
  })

  ipcMain.on(PREVIEW_IPC.CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.close()
  })
}

/** 原子写入文件：先写 .tmp 再 rename，避免写入中途崩溃留半截文件 */
function atomicWriteFile(filePath: string, content: string): void {
  const tmpPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`)
  writeFileSync(tmpPath, content, 'utf-8')
  renameSync(tmpPath, filePath)
}

/** 支持 PDF 预览的扩展名 */
const PDF_EXTENSIONS = new Set(['.pdf'])

/** 支持 DOCX 预览的扩展名 */
const DOCX_EXTENSIONS = new Set(['.docx'])

/**
 * 是否为 .env 系列文件（.env、.env.local、.env.production、.env.development.local 等）
 * 这类文件的 extname 会被识别为 .local/.production 等无意义后缀，需要单独判定。
 */
function isEnvFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return lower === '.env' || lower.startsWith('.env.')
}

/** 获取预览类型 */
function getPreviewType(filePath: string, ext: string): 'image' | 'video' | 'markdown' | 'code' | 'pdf' | 'docx' | 'unsupported' {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (DOCX_EXTENSIONS.has(ext)) return 'docx'
  const base = basename(filePath).toLowerCase()
  // .env 系列（.env / .env.local / .env.production 等）
  if (isEnvFile(base)) return 'code'
  // 无扩展名 / 不识别 → 检查特殊文件名（.gitignore、Dockerfile、bun.lock 等）
  if (SPECIAL_FILENAME_LANG[base]) return 'code'
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

/** 生成支持 light/dark 主题的通用页面样式（Typora 风格柔和配色） */
function baseStyles(): string {
  return `
    :root {
      color-scheme: light dark;
      --bg: #fafaf8;
      --bg-toolbar: rgba(250, 250, 248, 0.72);
      --border: #ececec;
      --text: #2c2c2c;
      --text-secondary: #6a6a6a;
      --text-muted: #a8a8a8;
      --btn-bg: transparent;
      --btn-border: transparent;
      --btn-hover: rgba(0, 0, 0, 0.06);
      --code-bg: #f3f1ec;
      --content-bg: #fafaf8;
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.08);
      --accent-border: rgba(37, 99, 235, 0.45);
      --table-row-alt: rgba(0, 0, 0, 0.025);
      --mark-bg: #fff3a3;
      --scrollbar: rgba(0, 0, 0, 0.18);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1e1e1e;
        --bg-toolbar: rgba(30, 30, 30, 0.72);
        --border: #2c2c2c;
        --text: #e6e6e6;
        --text-secondary: #b8b8b8;
        --text-muted: #7a7a7a;
        --btn-bg: transparent;
        --btn-border: transparent;
        --btn-hover: rgba(255, 255, 255, 0.08);
        --code-bg: #2a2a2a;
        --content-bg: #1e1e1e;
        --accent: #58a6ff;
        --accent-soft: rgba(88, 166, 255, 0.10);
        --accent-border: rgba(88, 166, 255, 0.55);
        --table-row-alt: rgba(255, 255, 255, 0.03);
        --mark-bg: rgba(255, 220, 100, 0.28);
        --scrollbar: rgba(255, 255, 255, 0.18);
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB',
        'Microsoft YaHei', 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      background: var(--bg-toolbar);
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
      -webkit-app-region: drag;
      flex-shrink: 0;
      border-bottom: 1px solid var(--border);
      transition: opacity 0.2s;
    }
    body[data-platform="darwin"] .toolbar { padding-left: 88px; }
    .toolbar-title {
      flex: 1;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toolbar-path {
      font-size: 10.5px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 1px;
      font-weight: 400;
    }
    .toolbar-btn {
      -webkit-app-region: no-drag;
      padding: 4px 10px;
      border: 1px solid var(--btn-border);
      border-radius: 6px;
      background: var(--btn-bg);
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }
    .toolbar-btn:hover {
      background: var(--btn-hover);
      color: var(--text);
    }
    .content {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--content-bg);
    }
    /* 自定义细滚动条 */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: var(--scrollbar);
      border-radius: 10px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    ::-webkit-scrollbar-thumb:hover { background-color: var(--scrollbar) !important; }
  `
}

/** 生成工具栏 HTML（编辑型文件含编辑/保存/取消按钮） */
function toolbarHtml(filePath: string, filename: string, editable: boolean, isMarkdown: boolean): string {
  const editButtons = editable
    ? `
    <button class="toolbar-btn" id="btn-edit">编辑</button>
    <button class="toolbar-btn" id="btn-save" style="display:none">保存</button>
    <button class="toolbar-btn" id="btn-cancel" style="display:none">取消</button>`
    : ''
  const mdToggle = isMarkdown
    ? `<button class="toolbar-btn" id="btn-md-toggle" style="display:none">预览</button>`
    : ''
  return `
  <div class="toolbar">
    <div style="flex:1; min-width:0">
      <div class="toolbar-title" id="tb-title">${escapeHtml(filename)}</div>
      <div class="toolbar-path">${escapeHtml(filePath)}</div>
    </div>
    ${mdToggle}
    ${editButtons}
    <button class="toolbar-btn" id="btn-open">用默认应用打开</button>
    <button class="toolbar-btn" id="btn-finder">在 Finder 中显示</button>
  </div>`
}

/** 生成工具栏按钮基础脚本（仅外部打开/Finder/Esc 关闭，可编辑模板会附加自己的逻辑） */
function toolbarScript(): string {
  return `
  <script>
    document.body.dataset.platform = ${JSON.stringify(process.platform)};
    if (window.previewAPI) {
      const btnOpen = document.getElementById('btn-open');
      const btnFinder = document.getElementById('btn-finder');
      if (btnOpen) btnOpen.onclick = () => window.previewAPI.openExternal();
      if (btnFinder) btnFinder.onclick = () => window.previewAPI.showInFolder();
    }
  </script>`
}

/** 编辑器统一样式 */
function editorStyles(): string {
  return `
    .editor-host {
      flex: 1;
      width: 100%;
      height: 100%;
      display: none;
      overflow: hidden;
    }
    .editor-host.active { display: block; }
    .preview-host.hidden { display: none !important; }
    .editor-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
    }
    .editor-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      background: rgba(0,0,0,0.8);
      color: #fff;
      border-radius: 6px;
      font-size: 13px;
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    .editor-toast.show { opacity: 1; }
  `
}

/**
 * 编辑器脚本：加载 Monaco、绑定按钮、保存/取消、外部变更感知。
 * @param previewHostId 预览内容 DOM id（编辑时隐藏）
 * @param isMarkdown   是否为 Markdown（影响切换按钮显示）
 * @param renderPreviewFnExpr  JS 表达式：调用即用最新内容刷新预览（仅 markdown 用）
 */
function editorScript(previewHostId: string, isMarkdown: boolean, renderPreviewFnExpr: string): string {
  return `
  <script>
  (function () {
    if (!window.previewAPI) return;

    let editor = null;
    let initialContent = '';
    let language = 'plaintext';
    let isDark = false;
    let mdMode = 'preview'; // 'preview' | 'source' (仅 markdown)
    const isMarkdown = ${JSON.stringify(isMarkdown)};

    const previewHost = document.getElementById(${JSON.stringify(previewHostId)});
    const editorHost = document.getElementById('editor-host');
    const btnEdit = document.getElementById('btn-edit');
    const btnSave = document.getElementById('btn-save');
    const btnCancel = document.getElementById('btn-cancel');
    const btnMdToggle = document.getElementById('btn-md-toggle');
    const toastEl = document.getElementById('editor-toast');

    function showToast(msg) {
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      setTimeout(() => toastEl.classList.remove('show'), 1500);
    }

    function setEditMode(on) {
      if (on) {
        previewHost.classList.add('hidden');
        editorHost.classList.add('active');
        btnEdit.style.display = 'none';
        btnSave.style.display = '';
        btnCancel.style.display = '';
        if (btnMdToggle) btnMdToggle.style.display = 'none';
        setTimeout(() => editor && editor.layout(), 0);
      } else {
        previewHost.classList.remove('hidden');
        editorHost.classList.remove('active');
        btnEdit.style.display = '';
        btnSave.style.display = 'none';
        btnCancel.style.display = 'none';
        if (isMarkdown && btnMdToggle) btnMdToggle.style.display = '';
      }
    }

    function loadMonaco() {
      return new Promise((resolve, reject) => {
        if (window.monaco) return resolve(window.monaco);
        const loaderScript = document.createElement('script');
        loaderScript.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js';
        loaderScript.onload = () => {
          window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
          window.require(['vs/editor/editor.main'], () => resolve(window.monaco));
        };
        loaderScript.onerror = () => reject(new Error('Monaco 加载失败，请检查网络'));
        document.head.appendChild(loaderScript);
      });
    }

    async function initEditor() {
      editorHost.innerHTML = '<div class="editor-loading">正在加载编辑器...</div>';
      try {
        const monaco = await loadMonaco();
        editorHost.innerHTML = '';
        editor = monaco.editor.create(editorHost, {
          value: initialContent,
          language,
          theme: isDark ? 'vs-dark' : 'vs',
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: false },
          tabSize: 2,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
        });
        editor.onDidChangeModelContent(() => {
          const dirty = editor.getValue() !== initialContent;
          window.previewAPI.setDirty(dirty);
        });
        editor.addCommand(
          (window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS),
          () => doSave()
        );
        editor.focus();
        // 暴露给主进程的关闭确认流程
        window.__getEditorContent = () => editor ? editor.getValue() : null;
      } catch (err) {
        editorHost.innerHTML = '<div class="editor-loading">' + (err.message || err) + '</div>';
      }
    }

    async function doSave() {
      if (!editor) return;
      const content = editor.getValue();
      const result = await window.previewAPI.save(content);
      if (result && result.success) {
        initialContent = content;
        window.previewAPI.setDirty(false);
        // 同步预览内容
        try { ${renderPreviewFnExpr || ''} } catch (e) { /* ignore */ }
        showToast('已保存');
      } else {
        showToast('保存失败：' + (result && result.error || '未知错误'));
      }
    }

    function doCancel() {
      if (editor && editor.getValue() !== initialContent) {
        if (!confirm('放弃当前修改？')) return;
        editor.setValue(initialContent);
      }
      window.previewAPI.setDirty(false);
      setEditMode(false);
    }

    if (btnEdit) {
      btnEdit.onclick = async () => {
        setEditMode(true);
        if (!editor) await initEditor();
      };
    }
    if (btnSave) btnSave.onclick = doSave;
    if (btnCancel) btnCancel.onclick = doCancel;

    if (isMarkdown && btnMdToggle) {
      btnMdToggle.onclick = () => {
        // 仅在非编辑态切换；编辑态期间按钮被隐藏
        // 此按钮在只读预览态作为「源码视图」入口
        if (mdMode === 'preview') {
          mdMode = 'source';
          btnMdToggle.textContent = '渲染';
          // 显示原始 markdown 文本（pre 包裹）
          previewHost.dataset.savedHtml = previewHost.innerHTML;
          previewHost.innerHTML = '<pre style="white-space:pre-wrap;font-family:SF Mono,Monaco,Menlo,monospace;font-size:13px;line-height:1.6">' +
            initialContent.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
        } else {
          mdMode = 'preview';
          btnMdToggle.textContent = '源码';
          if (previewHost.dataset.savedHtml) {
            previewHost.innerHTML = previewHost.dataset.savedHtml;
          }
        }
      };
    }

    // 接收主进程的初始数据（语言、主题）
    window.previewAPI.getInitial().then((info) => {
      if (!info) return;
      initialContent = info.content;
      language = info.language;
      isDark = info.isDark;
    });

    // 外部变更
    window.previewAPI.onExternalChanged((newContent) => {
      const dirty = editor && editor.getValue() !== initialContent;
      if (dirty) {
        const ok = confirm('文件已被外部修改。重新加载将丢失你当前的修改，是否重新加载？');
        if (!ok) return;
      }
      initialContent = newContent;
      if (editor) editor.setValue(newContent);
      try { ${renderPreviewFnExpr || ''} } catch (e) { /* ignore */ }
      window.previewAPI.setDirty(false);
      showToast('已从磁盘重新加载');
    });
  })();
  </script>`
}

/**
 * Markdown WYSIWYG 编辑脚本（基于 Vditor），替代 Monaco 用于 .md 文件。
 * 在 wysiwyg 模式下用户看到的是渲染后的样式，无需理解 markdown 语法。
 */
function vditorEditorScript(previewHostId: string): string {
  return `
  <script>
  (function () {
    if (!window.previewAPI) return;

    let vditor = null;
    let initialContent = '';
    let isDark = false;

    const previewHost = document.getElementById(${JSON.stringify(previewHostId)});
    const editorHost = document.getElementById('editor-host');
    const btnEdit = document.getElementById('btn-edit');
    const btnSave = document.getElementById('btn-save');
    const btnCancel = document.getElementById('btn-cancel');
    const btnMdToggle = document.getElementById('btn-md-toggle');
    const toastEl = document.getElementById('editor-toast');

    function showToast(msg) {
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      setTimeout(() => toastEl.classList.remove('show'), 1500);
    }

    function setEditMode(on) {
      if (on) {
        previewHost.classList.add('hidden');
        editorHost.classList.add('active');
        btnEdit.style.display = 'none';
        btnSave.style.display = '';
        btnCancel.style.display = '';
        if (btnMdToggle) btnMdToggle.style.display = 'none';
      } else {
        previewHost.classList.remove('hidden');
        editorHost.classList.remove('active');
        btnEdit.style.display = '';
        btnSave.style.display = 'none';
        btnCancel.style.display = 'none';
        if (btnMdToggle) btnMdToggle.style.display = '';
      }
    }

    function loadVditor() {
      return new Promise((resolve, reject) => {
        if (window.Vditor) return resolve(window.Vditor);
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdn.jsdelivr.net/npm/vditor@3/dist/index.css';
        document.head.appendChild(css);
        const js = document.createElement('script');
        js.src = 'https://cdn.jsdelivr.net/npm/vditor@3/dist/index.min.js';
        js.onload = () => resolve(window.Vditor);
        js.onerror = () => reject(new Error('Vditor 加载失败，请检查网络'));
        document.head.appendChild(js);
      });
    }

    async function initEditor() {
      editorHost.innerHTML = '<div class="editor-loading">正在加载编辑器...</div>';
      try {
        await loadVditor();
        editorHost.innerHTML = '<div id="vditor-instance" style="height:100%"></div>';
        vditor = new window.Vditor('vditor-instance', {
          mode: 'wysiwyg',
          value: initialContent,
          theme: isDark ? 'dark' : 'classic',
          height: '100%',
          minHeight: 200,
          cache: { enable: false },
          preview: { theme: { current: isDark ? 'dark' : 'light' } },
          toolbarConfig: { pin: true },
          counter: { enable: false },
          input: () => {
            const v = vditor.getValue();
            window.previewAPI.setDirty(v !== initialContent);
          },
          after: () => {
            vditor.focus();
            // Cmd/Ctrl+S 保存
            const ed = document.getElementById('vditor-instance');
            ed.addEventListener('keydown', (e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                doSave();
              }
            }, true);
          },
        });
        // 暴露给主进程的关闭确认流程
        window.__getEditorContent = () => vditor ? vditor.getValue() : null;
      } catch (err) {
        editorHost.innerHTML = '<div class="editor-loading">' + (err.message || err) + '</div>';
      }
    }

    async function doSave() {
      if (!vditor) return;
      const content = vditor.getValue();
      const result = await window.previewAPI.save(content);
      if (result && result.success) {
        initialContent = content;
        window.previewAPI.setDirty(false);
        // 同步只读预览
        try { renderMarkdown(content); } catch (e) { /* ignore */ }
        showToast('已保存');
      } else {
        showToast('保存失败：' + (result && result.error || '未知错误'));
      }
    }

    function doCancel() {
      if (vditor && vditor.getValue() !== initialContent) {
        if (!confirm('放弃当前修改？')) return;
        vditor.setValue(initialContent, true);
      }
      window.previewAPI.setDirty(false);
      setEditMode(false);
    }

    if (btnEdit) {
      btnEdit.onclick = async () => {
        setEditMode(true);
        if (!vditor) await initEditor();
      };
    }
    if (btnSave) btnSave.onclick = doSave;
    if (btnCancel) btnCancel.onclick = doCancel;

    // 只读态的源码/渲染切换（沿用此前逻辑）
    let mdMode = 'preview';
    if (btnMdToggle) {
      btnMdToggle.onclick = () => {
        if (mdMode === 'preview') {
          mdMode = 'source';
          btnMdToggle.textContent = '渲染';
          previewHost.dataset.savedHtml = previewHost.innerHTML;
          previewHost.innerHTML = '<pre style="white-space:pre-wrap;font-family:SF Mono,Monaco,Menlo,monospace;font-size:13px;line-height:1.6;padding:0">' +
            initialContent.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
        } else {
          mdMode = 'preview';
          btnMdToggle.textContent = '源码';
          if (previewHost.dataset.savedHtml) {
            previewHost.innerHTML = previewHost.dataset.savedHtml;
          }
        }
      };
    }

    // 接收主进程的初始数据
    window.previewAPI.getInitial().then((info) => {
      if (!info) return;
      initialContent = info.content;
      isDark = info.isDark;
    });

    // 外部变更
    window.previewAPI.onExternalChanged((newContent) => {
      const dirty = vditor && vditor.getValue() !== initialContent;
      if (dirty) {
        const ok = confirm('文件已被外部修改。重新加载将丢失你当前的修改，是否重新加载？');
        if (!ok) return;
      }
      initialContent = newContent;
      if (vditor) vditor.setValue(newContent, true);
      try { renderMarkdown(newContent); } catch (e) { /* ignore */ }
      window.previewAPI.setDirty(false);
      showToast('已从磁盘重新加载');
    });
  })();
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
  ${toolbarHtml(filePath, filename, false, false)}
  <div class="content">
    <img src="${fileUrl}" alt="${escapeHtml(filename)}" />
  </div>
  ${toolbarScript()}
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
  ${toolbarHtml(filePath, filename, false, false)}
  <div class="content">
    <video src="${fileUrl}" controls autoplay style="outline:none"></video>
  </div>
  ${toolbarScript()}
</body></html>`
}

/** 生成 Markdown 预览 HTML（支持编辑、源码切换） */
function markdownPreviewHtml(filePath: string, filename: string, textContent: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  ${editorStyles()}
  .content {
    display: flex;
    flex-direction: column;
    padding: 0;
    align-items: stretch;
    overflow: hidden;
  }
  .preview-host {
    flex: 1;
    overflow-y: auto;
    padding: 56px 64px 80px;
  }
  .markdown-body {
    max-width: 760px;
    margin: 0 auto;
    font-size: 15px;
    line-height: 1.75;
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB',
      'Microsoft YaHei', 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
  }
  .markdown-body h1, .markdown-body h2, .markdown-body h3,
  .markdown-body h4, .markdown-body h5, .markdown-body h6 {
    margin: 1.6em 0 0.6em;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.01em;
  }
  .markdown-body h1 {
    font-size: 1.9em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.35em;
    margin-top: 0;
  }
  .markdown-body h2 {
    font-size: 1.45em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.25em;
  }
  .markdown-body h3 { font-size: 1.2em; }
  .markdown-body h4 { font-size: 1.05em; color: var(--text-secondary); }
  .markdown-body h5, .markdown-body h6 { font-size: 0.95em; color: var(--text-secondary); }
  .markdown-body p { margin: 0.9em 0; }
  .markdown-body code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 5px;
    font-size: 0.88em;
    font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace;
    border: 1px solid var(--border);
  }
  .markdown-body pre {
    background: var(--code-bg);
    padding: 16px 20px;
    border-radius: 10px;
    overflow-x: auto;
    margin: 1.2em 0;
    font-size: 13px;
    line-height: 1.6;
    border: 1px solid var(--border);
  }
  .markdown-body pre code { background: none; padding: 0; font-size: inherit; border: none; }
  .markdown-body blockquote {
    border-left: 4px solid var(--accent-border);
    background: var(--accent-soft);
    padding: 0.6em 1em 0.6em 1.1em;
    color: var(--text);
    margin: 1.2em 0;
    border-radius: 0 8px 8px 0;
  }
  .markdown-body blockquote > :first-child { margin-top: 0; }
  .markdown-body blockquote > :last-child { margin-bottom: 0; }
  .markdown-body blockquote blockquote {
    border-left-color: var(--border);
    background: transparent;
    margin: 0.6em 0;
  }
  .markdown-body ul, .markdown-body ol { padding-left: 1.8em; margin: 0.6em 0; }
  .markdown-body li { margin: 0.35em 0; }
  .markdown-body li > p { margin: 0.3em 0; }
  .markdown-body ul.contains-task-list { padding-left: 0.4em; list-style: none; }
  .markdown-body li.task-list-item { list-style: none; padding-left: 0; }
  .markdown-body li.task-list-item input[type="checkbox"] {
    appearance: none;
    -webkit-appearance: none;
    width: 14px; height: 14px;
    border: 1.5px solid var(--border);
    border-radius: 3px;
    margin-right: 8px;
    vertical-align: -2px;
    background: var(--bg);
    cursor: default;
    position: relative;
  }
  .markdown-body li.task-list-item input[type="checkbox"]:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .markdown-body li.task-list-item input[type="checkbox"]:checked::after {
    content: '';
    position: absolute;
    left: 3px; top: 0px;
    width: 4px; height: 8px;
    border: solid white;
    border-width: 0 1.8px 1.8px 0;
    transform: rotate(45deg);
  }
  .markdown-body a { color: var(--accent); text-decoration: none; }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body table {
    border-collapse: separate;
    border-spacing: 0;
    margin: 1.2em 0;
    width: 100%;
    font-size: 0.95em;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .markdown-body th, .markdown-body td {
    border-bottom: 1px solid var(--border);
    padding: 9px 14px;
    text-align: left;
  }
  .markdown-body th + th, .markdown-body td + td { border-left: 1px solid var(--border); }
  .markdown-body tr:last-child td { border-bottom: none; }
  .markdown-body th { background: var(--code-bg); font-weight: 600; color: var(--text); }
  .markdown-body tbody tr:nth-child(even) { background: var(--table-row-alt); }
  .markdown-body img { max-width: 100%; border-radius: 8px; }
  .markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
  .markdown-body kbd {
    display: inline-block;
    padding: 1px 6px;
    font-size: 0.82em;
    font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', monospace;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    color: var(--text);
    vertical-align: 1px;
  }
  .markdown-body mark { background: var(--mark-bg); color: var(--text); padding: 0 3px; border-radius: 3px; }
  .markdown-body del { color: var(--text-muted); }
  .markdown-body strong { font-weight: 600; color: var(--text); }
</style></head><body>
  ${toolbarHtml(filePath, filename, true, true)}
  <div class="content">
    <div class="preview-host" id="md-preview-host">
      <div class="markdown-body" id="md-content"></div>
    </div>
    <div class="editor-host" id="editor-host"></div>
  </div>
  <div class="editor-toast" id="editor-toast"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
  <script>
    function renderMarkdown(raw) {
      var html;
      if (typeof marked !== 'undefined') {
        marked.setOptions({ gfm: true, breaks: true });
        html = marked.parse(raw);
        // Tag task lists for styling (marked renders <input type="checkbox"> inside <li>)
        html = html.replace(/<li>(\s*<input [^>]*type="checkbox"[^>]*>)/g, '<li class="task-list-item">$1');
        html = html.replace(/<ul>(\s*<li class="task-list-item">)/g, '<ul class="contains-task-list">$1');
      } else {
        html = '<pre>' + raw.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
      }
      document.getElementById('md-content').innerHTML = html;
    }
    renderMarkdown(${JSON.stringify(textContent)});
  </script>
  ${toolbarScript()}
  ${vditorEditorScript('md-preview-host')}
</body></html>`
}

/** 生成代码/文本预览 HTML（支持编辑） */
function codePreviewHtml(filePath: string, filename: string, textContent: string, ext: string): string {
  const lang = detectHljsLanguage(filePath, ext)
  const isDark = nativeTheme.shouldUseDarkColors

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  ${editorStyles()}
  .content {
    display: flex;
    flex-direction: column;
    padding: 0;
    align-items: stretch;
    overflow: hidden;
  }
  .preview-host {
    flex: 1;
    overflow: auto;
  }
  pre {
    padding: 28px 40px 60px;
    font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.65;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-all;
    tab-size: 2;
    width: 100%;
    background: var(--bg) !important;
  }
  code.hljs { background: transparent !important; padding: 0 !important; }
</style>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/${isDark ? 'github-dark' : 'github'}.min.css">
</head><body>
  ${toolbarHtml(filePath, filename, true, false)}
  <div class="content">
    <div class="preview-host" id="code-preview-host">
      <pre><code class="language-${lang}" id="code-content">${escapeHtml(textContent)}</code></pre>
    </div>
    <div class="editor-host" id="editor-host"></div>
  </div>
  <div class="editor-toast" id="editor-toast"></div>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"></script>
  <script>
    (async function () {
      const codeEl = document.getElementById('code-content');
      if (typeof hljs === 'undefined' || !codeEl) return;
      const lang = ${JSON.stringify(lang)};
      function applyHighlight() {
        try {
          const text = codeEl.textContent || '';
          const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
          codeEl.innerHTML = result.value;
          codeEl.classList.add('hljs');
        } catch (e) {
          // 兜底：自动检测
          try { hljs.highlightElement(codeEl); } catch (_) { /* ignore */ }
        }
      }
      if (lang === 'plaintext') {
        codeEl.classList.add('hljs');
        return;
      }
      if (!hljs.getLanguage(lang)) {
        // 主包未带的语言 → 从 cdn-release 拉子包注册
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/languages/' + lang + '.min.js';
          s.onload = resolve;
          s.onerror = resolve;
          document.head.appendChild(s);
        });
      }
      applyHighlight();
    })();
  </script>
  ${toolbarScript()}
  ${editorScript('code-preview-host', false, '')}
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
  ${toolbarHtml(filePath, filename, false, false)}
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
  ${toolbarScript()}
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
  ${toolbarHtml(filePath, filename, false, false)}
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
  ${toolbarScript()}
</body></html>`
}

/** 创建预览窗口并绑定脏状态关闭确认 */
function createPreviewWindow(filename: string): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(1200, workArea.width)
  const height = workArea.height
  const previewWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y,
    minWidth: 480,
    minHeight: 360,
    title: filename,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#fafaf8',
    webPreferences: {
      preload: join(__dirname, 'file-preview-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1.15,
    },
  })

  previewWindow.setMenuBarVisibility(false)

  previewWindow.webContents.on('did-finish-load', () => {
    if (!previewWindow.isDestroyed()) {
      previewWindow.webContents.setZoomFactor(1.15)
    }
  })

  // 在 'closed' 触发时 webContents 已销毁，提前缓存 id 用于状态查找/清理
  const wcId = previewWindow.webContents.id

  // Esc / Cmd+W (macOS) / Ctrl+W (Windows/Linux) 触发关闭（脏状态由 close 事件拦截）
  previewWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isCloseShortcut =
      input.key === 'Escape' ||
      (input.key.toLowerCase() === 'w' && (input.meta || input.control))
    if (isCloseShortcut) {
      event.preventDefault()
      if (!previewWindow.isDestroyed()) previewWindow.close()
    }
  })

  // 关闭前检查脏状态：弹原生确认 保存/放弃/取消
  previewWindow.on('close', (event) => {
    const state = previewStates.get(wcId)
    if (!state || !state.isDirty) return
    const choice = dialog.showMessageBoxSync(previewWindow, {
      type: 'warning',
      buttons: ['保存', '放弃修改', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '未保存的修改',
      message: `${state.filename} 有未保存的修改`,
      detail: '关闭窗口将丢失这些修改。',
    })
    if (choice === 2) {
      // 取消关闭
      event.preventDefault()
    } else if (choice === 0) {
      // 保存：请求渲染端把当前内容回传，再走标准关闭
      event.preventDefault()
      previewWindow.webContents
        .executeJavaScript('window.__getEditorContent && window.__getEditorContent()', true)
        .then((content: unknown) => {
          if (typeof content === 'string') {
            try {
              atomicWriteFile(state.filePath, content)
              state.initialContent = content
              state.isDirty = false
              state.selfWriteAt = Date.now()
            } catch (err) {
              dialog.showErrorBox('保存失败', err instanceof Error ? err.message : String(err))
              return
            }
          }
          if (!previewWindow.isDestroyed()) previewWindow.destroy()
        })
        .catch(() => {
          if (!previewWindow.isDestroyed()) previewWindow.destroy()
        })
    }
    // choice === 1: 放弃修改，让默认关闭流程继续
  })

  // 窗口关闭后清理状态与 watcher（webContents 已销毁，必须使用预先缓存的 id）
  previewWindow.on('closed', () => {
    const state = previewStates.get(wcId)
    if (state?.watcher) {
      try { state.watcher.close() } catch { /* ignore */ }
    }
    previewStates.delete(wcId)
  })

  return previewWindow
}

/** 监听文件外部变更，通知渲染端 */
function watchExternalChange(previewWindow: BrowserWindow, state: PreviewWindowState): void {
  let debounceTimer: NodeJS.Timeout | undefined
  try {
    state.watcher = fsWatch(state.filePath, () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        // 忽略 1.5 秒内由保存触发的事件
        if (Date.now() - state.selfWriteAt < 1500) return
        try {
          const newContent = readFileSync(state.filePath, 'utf-8')
          if (newContent === state.initialContent) return
          if (!previewWindow.isDestroyed()) {
            previewWindow.webContents.send(PREVIEW_IPC.ON_EXTERNAL_CHANGED, newContent)
          }
        } catch {
          // 文件可能被删除/重命名，忽略
        }
      }, 200)
    })
  } catch (err) {
    console.warn('[文件预览] 文件监听启动失败', err)
  }
}

/**
 * 解析待预览的文件路径
 * - 绝对路径：直接 resolve
 * - 相对路径：依次尝试 basePaths，返回第一个存在的；都不存在则返回基于第一个 base 的拼接结果
 *   （让后续 statSync 抛出更明确的错误，而不是被相对 process.cwd 误导）
 */
function resolveTargetPath(filePath: string, basePaths?: string[]): string {
  if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return resolve(filePath)
  }
  if (basePaths && basePaths.length > 0) {
    for (const base of basePaths) {
      if (!base) continue
      const candidate = resolve(base, filePath)
      if (existsSync(candidate)) return candidate
    }
    return resolve(basePaths[0]!, filePath)
  }
  return resolve(filePath)
}

/**
 * 在新窗口中预览文件
 * 不支持的文件类型会调用系统默认应用打开
 *
 * @param filePath 绝对路径或相对路径
 * @param basePaths 当 filePath 为相对路径时，依次尝试这些基础目录解析（主 cwd + 附加目录）
 */
export function openFilePreview(filePath: string, basePaths?: string[]): void {
  const safePath = resolveTargetPath(filePath, basePaths)
  const filename = basename(safePath)
  const ext = extname(safePath).toLowerCase()
  const previewType = getPreviewType(safePath, ext)

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

  ensureIpcRegistered()

  let html: string
  let initialContent = ''

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
    initialContent = readFileSync(safePath, 'utf-8')
    html = previewType === 'markdown'
      ? markdownPreviewHtml(safePath, filename, initialContent)
      : codePreviewHtml(safePath, filename, initialContent, ext)
  }

  const tmpHtmlPath = writeTempHtml(html)
  const previewWindow = createPreviewWindow(filename)

  // 注册窗口状态（必须在 loadFile 前，IPC 才能在 DOMContentLoaded 时拿到 initial）
  const state: PreviewWindowState = {
    filePath: safePath,
    filename,
    type: previewType,
    language: detectLanguage(safePath, ext),
    initialContent,
    isDirty: false,
    selfWriteAt: 0,
  }
  previewStates.set(previewWindow.webContents.id, state)

  // 仅可编辑文本类型才需要监听外部变更
  if (isEditableType(previewType)) {
    watchExternalChange(previewWindow, state)
  }

  previewWindow.loadFile(tmpHtmlPath)
}
