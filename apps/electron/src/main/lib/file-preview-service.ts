/**
 * 文件预览服务 — 内联预览支持
 *
 * 提供文件路径解析、PDF 预览 HTML 生成、DOCX 转 HTML 等功能，
 * 供 PreviewPanel 内联面板使用。
 */

import { basename, join, dirname, extname, resolve, posix as pathPosix } from 'node:path'
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { DOMParser } from '@xmldom/xmldom'
import type { OfficePreviewResult } from '@proma/shared'

const require = createRequire(__filename)
const PDFJS_PACKAGE = 'pdfjs-dist'

/** 文件大小限制：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_XLSX_SHEETS = 8
const MAX_XLSX_ROWS = 100
const MAX_XLSX_COLUMNS = 40
const MAX_PPTX_SLIDES = 80

// ─── 临时文件 ───

function getPreviewTmpDir(): string {
  const dir = join(tmpdir(), 'proma-preview')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function writeTempHtml(html: string): string {
  const tmpDir = getPreviewTmpDir()
  const contentHash = createHash('md5').update(html).digest('hex').slice(0, 16)
  const tmpFile = join(tmpDir, `preview-${contentHash}.html`)
  if (!existsSync(tmpFile)) {
    writeFileSync(tmpFile, html, 'utf-8')
  }
  return tmpFile
}

/** 清理所有临时预览文件 */
export function cleanPreviewTmpDir(): number {
  const dir = join(tmpdir(), 'proma-preview')
  if (!existsSync(dir)) return 0
  let count = 0
  try {
    for (const f of readdirSync(dir)) {
      try { unlinkSync(join(dir, f)); count++ } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return count
}

// ─── 路径解析 ───

/**
 * 在目录中递归搜索指定文件名
 */
function searchFileInDir(dir: string, targetName: string, maxDepth = 8): string | null {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache', 'target'])
  let scanned = 0
  const MAX_SCANNED = 500

  function walk(current: string, depth: number): string | null {
    if (depth > maxDepth || scanned > MAX_SCANNED) return null
    try {
      const entries = readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name === targetName) {
          return join(current, entry.name)
        }
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          scanned++
          const found = walk(join(current, entry.name), depth + 1)
          if (found) return found
        }
      }
    } catch { /* permission denied etc */ }
    return null
  }

  return walk(dir, 0)
}

/**
 * 解析待预览的文件路径
 * - 绝对路径：直接 resolve，不存在时 fallback 搜索
 * - 相对路径：依次尝试 basePaths，返回第一个存在的；都不存在则 fallback 搜索
 */
export function resolveTargetPath(filePath: string, basePaths?: string[]): string {
  if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
    const direct = resolve(filePath)
    if (existsSync(direct)) return direct
    const name = basename(direct)
    if (basePaths) {
      for (const base of basePaths) {
        if (!base) continue
        const found = searchFileInDir(base, name)
        if (found) return found
      }
    }
    const awIdx = filePath.indexOf('agent-workspaces')
    if (awIdx !== -1) {
      const wsRoot = filePath.slice(0, awIdx + 'agent-workspaces'.length)
      if (existsSync(wsRoot)) {
        const found = searchFileInDir(wsRoot, name)
        if (found) return found
      }
    }
    return direct
  }
  if (basePaths && basePaths.length > 0) {
    const firstSegment = filePath.split('/')[0]
    if (firstSegment) {
      for (const base of basePaths) {
        if (!base) continue
        if (basename(base) === firstSegment) {
          const candidate = resolve(dirname(base), filePath)
          if (existsSync(candidate)) return candidate
        }
      }
    }
    for (const base of basePaths) {
      if (!base) continue
      const candidate = resolve(base, filePath)
      if (existsSync(candidate)) return candidate
    }
    const home = homedir()
    const homeCandidate = resolve(home, filePath)
    if (existsSync(homeCandidate)) return homeCandidate
    const rootCandidate = resolve('/', filePath)
    if (existsSync(rootCandidate)) return rootCandidate
    const name = basename(filePath)
    for (const base of basePaths) {
      if (!base) continue
      const found = searchFileInDir(base, name)
      if (found) return found
    }
    return resolve(basePaths[0]!, filePath)
  }
  const homeCandidate = resolve(homedir(), filePath)
  if (existsSync(homeCandidate)) return homeCandidate
  const rootCandidate = resolve('/', filePath)
  if (existsSync(rootCandidate)) return rootCandidate
  return resolve(filePath)
}

// ─── Office Open XML 预览 ───

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function getElementsByLocalName(root: Node, localName: string): Element[] {
  const result: Element[] = []

  function walk(node: Node): void {
    const children = node.childNodes
    if (!children) return
    for (let i = 0; i < children.length; i++) {
      const child = children.item(i)
      if (child.nodeType === 1) {
        const element = child as Element
        if (element.localName === localName || element.nodeName === localName) {
          result.push(element)
        }
      }
      walk(child)
    }
  }

  walk(root)
  return result
}

function getDirectChildElementsByLocalName(root: Element | Document, localName: string): Element[] {
  const result: Element[] = []
  const children = root.childNodes
  if (!children) return result
  for (let i = 0; i < children.length; i++) {
    const child = children.item(i)
    if (child.nodeType !== 1) continue
    const element = child as Element
    if (element.localName === localName || element.nodeName === localName) {
      result.push(element)
    }
  }
  return result
}

function getFirstTextByLocalName(root: Element, localName: string): string {
  return getElementsByLocalName(root, localName)[0]?.textContent ?? ''
}

function readZipText(zip: AdmZip, path: string): string | null {
  const entry = zip.getEntry(path)
  return entry ? entry.getData().toString('utf-8') : null
}

function normalizeZipTarget(baseDir: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, '/')
  if (normalizedTarget.startsWith('/')) return normalizedTarget.slice(1)
  return pathPosix.normalize(pathPosix.join(baseDir, normalizedTarget))
}

function parseRelationships(zip: AdmZip, relsPath: string, baseDir: string): Map<string, string> {
  const relsXml = readZipText(zip, relsPath)
  const rels = new Map<string, string>()
  if (!relsXml) return rels

  const relsDoc = parseXml(relsXml)
  for (const rel of getElementsByLocalName(relsDoc, 'Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) continue
    rels.set(id, normalizeZipTarget(baseDir, target))
  }
  return rels
}

function parseSharedStrings(zip: AdmZip): string[] {
  const sharedXml = readZipText(zip, 'xl/sharedStrings.xml')
  if (!sharedXml) return []

  const doc = parseXml(sharedXml)
  return getElementsByLocalName(doc, 'si').map((si) => (
    getElementsByLocalName(si, 't').map((node) => node.textContent ?? '').join('')
  ))
}

function isDateNumFmtId(numFmtId: number): boolean {
  return (
    (numFmtId >= 14 && numFmtId <= 22) ||
    (numFmtId >= 27 && numFmtId <= 36) ||
    (numFmtId >= 45 && numFmtId <= 47) ||
    (numFmtId >= 50 && numFmtId <= 58)
  )
}

function isDateFormatCode(formatCode: string): boolean {
  const normalized = formatCode
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*]/g, '')
    .toLowerCase()
  return /[ymdhHsS]/.test(normalized)
}

function parseXlsxDateStyleIndexes(zip: AdmZip): Set<number> {
  const stylesXml = readZipText(zip, 'xl/styles.xml')
  const dateStyleIndexes = new Set<number>()
  if (!stylesXml) return dateStyleIndexes

  const doc = parseXml(stylesXml)
  const customFormats = new Map<number, string>()
  for (const numFmt of getElementsByLocalName(doc, 'numFmt')) {
    const id = Number(numFmt.getAttribute('numFmtId'))
    const code = numFmt.getAttribute('formatCode') ?? ''
    if (Number.isFinite(id) && code) customFormats.set(id, code)
  }

  const cellXfs = getElementsByLocalName(doc, 'cellXfs')[0]
  if (!cellXfs) return dateStyleIndexes

  getDirectChildElementsByLocalName(cellXfs, 'xf').forEach((xf, index) => {
    const numFmtId = Number(xf.getAttribute('numFmtId'))
    if (!Number.isFinite(numFmtId)) return
    const customFormatCode = customFormats.get(numFmtId)
    if (isDateNumFmtId(numFmtId) || (customFormatCode && isDateFormatCode(customFormatCode))) {
      dateStyleIndexes.add(index)
    }
  })

  return dateStyleIndexes
}

function formatExcelSerialDate(rawValue: string): string {
  const serial = Number(rawValue)
  if (!Number.isFinite(serial)) return rawValue

  const millis = Math.round((serial - 25569) * 86400 * 1000)
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return rawValue

  const year = date.getUTCFullYear()
  if (year < 1900 || year > 9999) return rawValue

  const pad = (value: number) => String(value).padStart(2, '0')
  const dateText = `${year}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const hasTime = Math.abs(serial - Math.floor(serial)) > 0.000001
  if (!hasTime) return dateText
  return `${dateText} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function columnIndexFromCellRef(cellRef: string): number {
  const letters = cellRef.match(/[A-Za-z]+/)?.[0]?.toUpperCase()
  if (!letters) return 0
  let index = 0
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return Math.max(0, index - 1)
}

function columnNameFromIndex(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function getXlsxCellText(cell: Element, sharedStrings: string[], dateStyleIndexes: Set<number>): string {
  const type = cell.getAttribute('t')
  if (type === 'inlineStr') {
    return getElementsByLocalName(cell, 't').map((node) => node.textContent ?? '').join('')
  }

  const value = getFirstTextByLocalName(cell, 'v')
  if (!value) return ''

  if (type === 's') {
    const sharedIndex = Number(value)
    return Number.isInteger(sharedIndex) ? sharedStrings[sharedIndex] ?? '' : ''
  }
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE'

  const styleIndex = Number(cell.getAttribute('s'))
  if (!type && Number.isInteger(styleIndex) && dateStyleIndexes.has(styleIndex)) {
    return formatExcelSerialDate(value)
  }

  return value
}

function parseXlsxSheetRows(
  zip: AdmZip,
  sheetPath: string,
  sharedStrings: string[],
  dateStyleIndexes: Set<number>,
): { rows: string[][]; truncatedRows: boolean; truncatedColumns: boolean } {
  const sheetXml = readZipText(zip, sheetPath)
  if (!sheetXml) return { rows: [], truncatedRows: false, truncatedColumns: false }

  const doc = parseXml(sheetXml)
  const rows: string[][] = []
  let truncatedRows = false
  let truncatedColumns = false

  for (const row of getElementsByLocalName(doc, 'row')) {
    if (rows.length >= MAX_XLSX_ROWS) {
      truncatedRows = true
      break
    }

    const values: string[] = []
    for (const cell of getDirectChildElementsByLocalName(row, 'c')) {
      const cellRef = cell.getAttribute('r') ?? ''
      const colIndex = columnIndexFromCellRef(cellRef)
      if (colIndex >= MAX_XLSX_COLUMNS) {
        truncatedColumns = true
        continue
      }
      values[colIndex] = getXlsxCellText(cell, sharedStrings, dateStyleIndexes)
    }

    while (values.length > 0 && !values[values.length - 1]) values.pop()
    if (values.some((value) => value.trim().length > 0)) rows.push(values)
  }

  return { rows, truncatedRows, truncatedColumns }
}

function renderXlsxTable(rows: string[][]): string {
  if (rows.length === 0) {
    return '<div class="office-empty">这个工作表没有可预览的数据</div>'
  }

  const columnCount = Math.max(...rows.map((row) => row.length), 1)
  const headerCells = Array.from({ length: columnCount }, (_, index) => (
    `<th>${escapeHtml(columnNameFromIndex(index))}</th>`
  )).join('')
  const bodyRows = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, index) => (
      `<td>${escapeHtml(row[index] ?? '')}</td>`
    )).join('')
    return `<tr><th class="office-row-heading">${rowIndex + 1}</th>${cells}</tr>`
  }).join('')

  return `<div class="office-table-wrap"><table><thead><tr><th></th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`
}

function convertXlsxToHtml(filePath: string, resolvedPath: string): OfficePreviewResult {
  const zip = new AdmZip(resolvedPath)
  const workbookXml = readZipText(zip, 'xl/workbook.xml')
  if (!workbookXml) throw new Error('Invalid XLSX: workbook.xml missing')

  const workbookDoc = parseXml(workbookXml)
  const relationships = parseRelationships(zip, 'xl/_rels/workbook.xml.rels', 'xl')
  const sharedStrings = parseSharedStrings(zip)
  const dateStyleIndexes = parseXlsxDateStyleIndexes(zip)
  const sheets = getElementsByLocalName(workbookDoc, 'sheet')

  let truncatedSheets = false
  let truncatedRows = false
  let truncatedColumns = false
  const textParts: string[] = []
  const htmlParts: string[] = []

  sheets.slice(0, MAX_XLSX_SHEETS).forEach((sheet, sheetIndex) => {
    const name = sheet.getAttribute('name') || `Sheet ${sheetIndex + 1}`
    const relationshipId = sheet.getAttribute('r:id') ?? sheet.getAttribute('id')
    const sheetPath = relationshipId ? relationships.get(relationshipId) : undefined
    if (!sheetPath) return

    const parsed = parseXlsxSheetRows(zip, sheetPath, sharedStrings, dateStyleIndexes)
    truncatedRows ||= parsed.truncatedRows
    truncatedColumns ||= parsed.truncatedColumns
    textParts.push(`[${name}]`)
    textParts.push(...parsed.rows.map((row) => row.join('\t')))
    htmlParts.push(`<section class="office-sheet"><h3>${escapeHtml(name)}</h3>${renderXlsxTable(parsed.rows)}</section>`)
  })

  if (htmlParts.length === 0) {
    throw new Error('Invalid XLSX: no worksheet data resolved')
  }

  truncatedSheets = sheets.length > MAX_XLSX_SHEETS
  const notices = [
    truncatedSheets ? `仅显示前 ${MAX_XLSX_SHEETS} 个工作表` : null,
    truncatedRows ? `每个工作表最多显示 ${MAX_XLSX_ROWS} 行` : null,
    truncatedColumns ? `每行最多显示 ${MAX_XLSX_COLUMNS} 列` : null,
  ].filter(Boolean)
  const noticeHtml = notices.length > 0
    ? `<div class="office-preview-notice">${escapeHtml(notices.join('，'))}</div>`
    : ''
  const title = escapeHtml(basename(filePath))
  const html = `<div class="office-preview office-preview-spreadsheet"><div class="office-preview-title">${title}</div>${noticeHtml}${htmlParts.join('')}</div>`

  return {
    resolvedPath,
    kind: 'spreadsheet',
    html,
    text: textParts.join('\n').trim(),
  }
}

function getPptxSlidePaths(zip: AdmZip): string[] {
  const presentationXml = readZipText(zip, 'ppt/presentation.xml')
  const relationships = parseRelationships(zip, 'ppt/_rels/presentation.xml.rels', 'ppt')
  if (presentationXml) {
    const doc = parseXml(presentationXml)
    const slidePaths = getElementsByLocalName(doc, 'sldId')
      .map((slide) => slide.getAttribute('r:id') ?? slide.getAttribute('id'))
      .map((relationshipId) => relationshipId ? relationships.get(relationshipId) : undefined)
      .filter((path): path is string => Boolean(path))
    if (slidePaths.length > 0) return slidePaths
  }

  return zip.getEntries()
    .map((entry) => entry.entryName)
    .filter((entryName) => /^ppt\/slides\/slide\d+\.xml$/.test(entryName))
    .sort((a, b) => {
      const aIndex = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      const bIndex = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return aIndex - bIndex
    })
}

function getPptxSlideText(zip: AdmZip, slidePath: string): string[] {
  const slideXml = readZipText(zip, slidePath)
  if (!slideXml) return []

  const doc = parseXml(slideXml)
  return getElementsByLocalName(doc, 'p')
    .map((paragraph) => getElementsByLocalName(paragraph, 't').map((textNode) => textNode.textContent ?? '').join('').trim())
    .filter(Boolean)
}

function convertPptxToHtml(filePath: string, resolvedPath: string): OfficePreviewResult {
  const zip = new AdmZip(resolvedPath)
  const slidePaths = getPptxSlidePaths(zip)
  const visibleSlidePaths = slidePaths.slice(0, MAX_PPTX_SLIDES)
  const textParts: string[] = []
  const slideHtml = visibleSlidePaths.map((slidePath, index) => {
    const lines = getPptxSlideText(zip, slidePath)
    textParts.push(`幻灯片 ${index + 1}`)
    textParts.push(...lines)
    const title = lines[0] || '（无标题）'
    const body = lines.length > 1
      ? `<ul>${lines.slice(1).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '<div class="office-empty">这页没有更多可提取文本</div>'
    return `<section class="office-slide"><div class="office-slide-index">幻灯片 ${index + 1}</div><h3>${escapeHtml(title)}</h3>${body}</section>`
  }).join('')

  const noticeHtml = slidePaths.length > MAX_PPTX_SLIDES
    ? `<div class="office-preview-notice">仅显示前 ${MAX_PPTX_SLIDES} 页幻灯片</div>`
    : ''
  const emptyHtml = slideHtml || '<div class="office-empty">这个 PPTX 没有可提取的文本内容</div>'
  const title = escapeHtml(basename(filePath))
  const html = `<div class="office-preview office-preview-presentation"><div class="office-preview-title">${title}</div>${noticeHtml}${emptyHtml}</div>`

  return {
    resolvedPath,
    kind: 'presentation',
    html,
    text: textParts.join('\n').trim(),
  }
}

// ─── 导出：内联预览 API ───

/** 解析文件路径并读取内容（供内联文本/代码预览使用） */
export function resolveAndReadFile(filePath: string, basePaths?: string[]): { resolvedPath: string; content: string } | null {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null
  try {
    const st = statSync(safePath)
    if (st.size > MAX_FILE_SIZE) return null
    const content = readFileSync(safePath, 'utf-8')
    return { resolvedPath: safePath, content }
  } catch {
    return null
  }
}

/** 仅解析文件路径（不读取内容），供图片等用 proma-file:// 协议加载的场景使用 */
export function resolveFilePath(filePath: string, basePaths?: string[]): string | null {
  const safePath = resolveTargetPath(filePath, basePaths)
  return existsSync(safePath) ? safePath : null
}

/** 为内联 PDF 预览生成临时 HTML 文件（使用 proma-file:// 加载 PDF，无体积膨胀） */
export async function preparePdfPreview(filePath: string, basePaths?: string[]): Promise<{ resolvedPath: string; tmpHtmlUrl: string } | null> {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null
  const st = statSync(safePath)
  if (st.size > MAX_FILE_SIZE) return null

  let fileUrl: string
  let pdfScriptUrl: string
  let pdfWorkerUrl: string
  let standardFontDataUrl: string
  let registerFilePath: (path: string) => string
  try {
    const { registerPromaDirectoryPath, registerPromaFilePath } = await import('./local-file-protocol')
    registerFilePath = registerPromaFilePath
    fileUrl = registerPromaFilePath(safePath)
    pdfScriptUrl = registerPromaFilePath(require.resolve(`${PDFJS_PACKAGE}/build/pdf.min.mjs`))
    pdfWorkerUrl = registerPromaFilePath(require.resolve(`${PDFJS_PACKAGE}/build/pdf.worker.min.mjs`))
    const pdfPackageDir = dirname(require.resolve(`${PDFJS_PACKAGE}/package.json`))
    standardFontDataUrl = `${registerPromaDirectoryPath(join(pdfPackageDir, 'standard_fonts'))}/`
  } catch (err) {
    console.error('[file-preview] preparePdfPreview asset resolution failed:', err)
    return null
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: transparent; overflow: auto; padding: 16px; }
  #c { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; width: fit-content; min-width: 100%; }
  #c canvas { box-shadow: 0 2px 8px rgba(0,0,0,0.15); margin: 0 auto; display: block; }
  .loading { color: #888; font: 12px/1.5 system-ui; padding: 40px; text-align: center; width: 100%; }
  .error { color: #f87171; font: 12px/1.5 system-ui; padding: 20px; text-align: center; width: 100%; }
  .page-info { color: #888; font: 11px/1.5 system-ui; text-align: center; padding: 4px; width: 100%; }
</style>
</head><body>
  <div class="loading" id="c">正在加载 PDF...</div>
  <script type="module">
    const container = document.getElementById('c');
    const fileUrl = ${JSON.stringify(fileUrl)};
    const pdfScriptUrl = ${JSON.stringify(pdfScriptUrl)};
    const pdfWorkerUrl = ${JSON.stringify(pdfWorkerUrl)};
    const standardFontDataUrl = ${JSON.stringify(standardFontDataUrl)};
    const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    let stepIdx = 2;
    let pdfDoc = null;

    function notifyZoom() {
      window.parent.postMessage({ type: 'pdf-zoom-changed', zoom: Math.round(STEPS[stepIdx] * 100) }, '*');
    }

    async function renderAll() {
      if (!pdfDoc) return;
      container.innerHTML = '';
      const userScale = STEPS[stepIdx];
      const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const vp = page.getViewport({ scale: userScale * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.width = (vp.width / dpr) + 'px';
        canvas.style.height = (vp.height / dpr) + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        container.appendChild(canvas);
      }
      const info = document.createElement('div');
      info.className = 'page-info';
      info.textContent = '共 ' + pdfDoc.numPages + ' 页';
      container.appendChild(info);
      notifyZoom();
    }

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'pdf-zoom') {
        if (e.data.direction === 'in' && stepIdx < STEPS.length - 1) { stepIdx++; renderAll(); }
        if (e.data.direction === 'out' && stepIdx > 0) { stepIdx--; renderAll(); }
      }
    });

    try {
      const pdfjsLib = await import(pdfScriptUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      pdfDoc = await pdfjsLib.getDocument({
        url: fileUrl,
        standardFontDataUrl,
      }).promise;
      await renderAll();
    } catch (err) {
      container.innerHTML = '<div class="error">PDF 加载失败: ' + err.message + '<\\/div>';
    }
  <\/script>
<\/body><\/html>`
  const tmpHtmlPath = writeTempHtml(html)
  const tmpHtmlUrl = registerFilePath(tmpHtmlPath)
  return { resolvedPath: safePath, tmpHtmlUrl }
}

/** 将 DOCX 文件转换为 HTML（供内联预览使用） */
export async function convertDocxToHtml(filePath: string, basePaths?: string[]): Promise<{ resolvedPath: string; html: string } | null> {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null
  try {
    const st = statSync(safePath)
    if (st.size > MAX_FILE_SIZE) return null
    const mammoth = await import('mammoth')
    const result = await mammoth.convertToHtml({ path: safePath })
    return { resolvedPath: safePath, html: result.value }
  } catch (err) {
    console.error('[file-preview] convertDocxToHtml failed:', err)
    return null
  }
}

function renderOfficeTextFallback(filePath: string, text: string, kind: OfficePreviewResult['kind']): string {
  const title = escapeHtml(basename(filePath))
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const body = paragraphs.length > 0
    ? paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
    : '<div class="office-empty">没有可提取的文本内容</div>'
  return `<div class="office-preview office-preview-${kind}"><div class="office-preview-title">${title}</div>${body}</div>`
}

/** 将 XLSX/PPTX 转成可内联展示的 HTML 预览 */
export async function convertOfficeToHtml(filePath: string, basePaths?: string[]): Promise<OfficePreviewResult | null> {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null

  try {
    const st = statSync(safePath)
    if (st.size > MAX_FILE_SIZE) return null

    const ext = extname(safePath).toLowerCase()
    if (ext === '.xlsx') return convertXlsxToHtml(filePath, safePath)
    if (ext === '.pptx') return convertPptxToHtml(filePath, safePath)
    return null
  } catch (err) {
    console.error('[file-preview] convertOfficeToHtml structured preview failed:', err)
    try {
      const officeParser = await import('officeparser')
      const text = await officeParser.parseOfficeAsync(safePath)
      const ext = extname(safePath).toLowerCase()
      const kind: OfficePreviewResult['kind'] = ext === '.pptx' ? 'presentation' : 'spreadsheet'
      return {
        resolvedPath: safePath,
        kind,
        html: renderOfficeTextFallback(filePath, text, kind),
        text,
      }
    } catch (fallbackErr) {
      console.error('[file-preview] convertOfficeToHtml text fallback failed:', fallbackErr)
      return null
    }
  }
}
