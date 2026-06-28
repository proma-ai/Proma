/**
 * 文档解析服务
 *
 * 负责从各类办公文档中提取纯文本内容。
 * 支持的格式：
 * - PDF：使用 pdf-parse 提取文本，必要时用 pdfjs-dist 兜底
 * - DOC/WPS：使用 word-extractor 提取文本（旧版 Word/WPS Writer）
 * - DOCX/XLSX/PPTX/ODP/ODS/ODT 及宏/模板变体：使用 mammoth/officeparser 提取文本
 * - RTF：使用内置的 brace 感知解析器提取文本
 * - TXT/MD/CSV/JSON/XML/HTML/JS/TS/PY 等：直接 UTF-8 读取
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { resolveAttachmentPath } from './config-paths'

// ===== 文件类型分类 =====

/** officeparser 支持的格式 */
const OFFICE_EXTENSIONS = new Set([
  '.docx', '.xlsx', '.pptx',
  '.odt', '.odp', '.ods',
  '.docm', '.dotx', '.dotm',
  '.xlsm', '.xltx', '.xltm',
  '.pptm', '.potx', '.potm', '.ppsx', '.ppsm',
])

/** 旧版 Word/WPS Writer 格式 */
const LEGACY_WORD_EXTENSIONS = new Set([
  '.doc', '.dot', '.wps', '.wpt',
])

/** WPS 原生表格/演示格式：尽量交给 Office 解析器尝试 */
const WPS_OFFICE_EXTENSIONS = new Set([
  '.et', '.ett', '.dps', '.dpt',
])

/** RTF 文档 */
const RICH_TEXT_EXTENSIONS = new Set([
  '.rtf',
])

/** 纯文本格式（直接 UTF-8 读取） */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html',
  '.js', '.ts', '.py', '.yaml', '.yml', '.toml',
  '.log', '.ini', '.cfg', '.conf', '.sh', '.bat',
  '.css', '.scss', '.less', '.sql', '.graphql',
  '.env', '.gitignore', '.dockerfile',
])

/** 所有支持文档解析的扩展名（不含图片） */
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  ...OFFICE_EXTENSIONS,
  ...LEGACY_WORD_EXTENSIONS,
  ...WPS_OFFICE_EXTENSIONS,
  ...RICH_TEXT_EXTENSIONS,
  ...TEXT_EXTENSIONS,
])

/**
 * 判断文件扩展名是否支持文本提取
 *
 * @param ext 文件扩展名（含点号，如 '.pdf'）
 */
export function isSupportedDocumentExtension(ext: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(ext.toLowerCase())
}

/**
 * 根据 MIME 类型判断是否为可解析文档（非图片附件）
 *
 * 排除图片类型，其余尝试按扩展名判断。
 */
export function isDocumentAttachment(mediaType: string): boolean {
  return !mediaType.startsWith('image/')
}

/**
 * 从文件中提取纯文本内容
 *
 * 根据文件扩展名选择合适的解析器：
 * - .pdf → pdf-parse，必要时 pdfjs-dist
 * - .doc/.dot/.wps/.wpt → word-extractor
 * - .docx/.xlsx/.pptx/.odt/.odp/.ods 等 → mammoth/officeparser
 * - .txt/.md/... → 直接 UTF-8 读取
 *
 * @param filePath 文件的完整路径
 * @returns 提取的纯文本内容
 * @throws 不支持的格式或解析失败时抛出错误
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()

  // PDF 文件
  if (ext === '.pdf') {
    return extractPdf(filePath)
  }

  // 旧版 Word/WPS Writer 文件
  if (LEGACY_WORD_EXTENSIONS.has(ext)) {
    return extractLegacyWord(filePath)
  }

  // Office 和 OpenDocument 格式
  if (OFFICE_EXTENSIONS.has(ext)) {
    return extractOffice(filePath)
  }

  // WPS 原生表格/演示格式
  if (WPS_OFFICE_EXTENSIONS.has(ext)) {
    return extractWpsOffice(filePath)
  }

  // 富文本格式（RTF 不是 OOXML，单独解析）
  if (RICH_TEXT_EXTENSIONS.has(ext)) {
    return extractRichText(filePath)
  }

  // 纯文本格式
  if (TEXT_EXTENSIONS.has(ext)) {
    return readFileSync(filePath, 'utf-8')
  }

  // 未知格式：尝试当作文本读取
  console.warn(`[文档解析] 未知格式 ${ext}，尝试作为文本读取: ${filePath}`)
  return readFileSync(filePath, 'utf-8')
}

/**
 * 提取 PDF 文本
 */
async function extractPdf(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath)

  try {
    const pdfParse = (await import('pdf-parse')).default
    const result = await pdfParse(buffer)
    const text = result.text.trim()
    if (text.length > 0) {
      console.log(`[文档解析] PDF 提取完成: ${result.numpages} 页, ${result.text.length} 字符`)
      return result.text
    }
    console.warn(`[文档解析] PDF 文本为空，尝试 pdfjs-dist 兜底: ${filePath}`)
  } catch (error) {
    console.warn(`[文档解析] pdf-parse 提取失败，尝试 pdfjs-dist 兜底: ${filePath}`, error)
  }

  const text = await extractPdfWithPdfJs(buffer)
  console.log(`[文档解析] PDF 兜底提取完成: ${text.length} 字符`)
  return text
}

/**
 * 提取旧版 Word/WPS Writer 文本
 */
async function extractLegacyWord(filePath: string): Promise<string> {
  const WordExtractor = (await import('word-extractor')).default
  const extractor = new WordExtractor()
  const extracted = await extractor.extract(filePath)
  const text = extracted.getBody()
  console.log(`[文档解析] 旧版 Word/WPS 提取完成: ${text.length} 字符`)
  return text
}

/**
 * 提取 Office/OpenDocument 文本（DOCX, XLSX, PPTX, ODT, ODP, ODS 及宏/模板变体）
 *
 * officeparser 仅按扩展名分发，且只认 docx/xlsx/pptx/odt/odp/ods/pdf 七种。
 * 但宏启用（.docm/.xlsm/.pptm）、模板（.dotx/.xltx/.potx 等）、放映（.ppsx/.ppsm）
 * 本质都是标准 OOXML zip 包，仅扩展名不同。officeparser 在收到 Buffer 时改用
 * file-type 按文件内容嗅探类型，从而绕过扩展名白名单、正确路由这些变体。
 * 因此这里统一以 Buffer 传入，让所有 OOXML 变体都能被解析。
 */
async function extractOffice(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.docx' || ext === '.docm' || ext === '.dotx' || ext === '.dotm') {
    try {
      const text = await extractDocxWithMammoth(filePath)
      if (text.trim()) {
        console.log(`[文档解析] DOCX 提取完成: ${text.length} 字符`)
        return text
      }
    } catch (error) {
      console.warn(`[文档解析] mammoth 提取失败，尝试 officeparser 兜底: ${filePath}`, error)
    }
  }

  // 以 Buffer 传入，officeparser 会按内容（而非扩展名）嗅探并路由。
  const buffer = readFileSync(filePath)
  const officeParser = await import('officeparser') as unknown as OfficeParserModule
  const text = await officeParser.parseOfficeAsync(buffer)
  console.log(`[文档解析] Office 提取完成: ${text.length} 字符`)
  return text
}

/**
 * 提取 WPS 原生表格/演示文本
 */
async function extractWpsOffice(filePath: string): Promise<string> {
  try {
    return await extractOffice(filePath)
  } catch (error) {
    const ext = extname(filePath).toLowerCase()
    console.warn(`[文档解析] WPS 原生格式提取失败: ${filePath}`, error)
    throw new Error(`暂不支持解析 ${ext} 原生格式，请在 WPS 中另存为 DOCX/XLSX/PPTX 或 PDF 后重试`)
  }
}

/**
 * 提取 RTF 富文本
 *
 * RTF 不是 OOXML zip，officeparser/mammoth 都无法解析。这里用一个轻量的
 * brace 感知解析器：跳过字体表/颜色表/样式表等控制性分组，仅保留正文，
 * 并把 \par \line \tab 等转成对应的空白字符。无需引入额外依赖。
 */
async function extractRichText(filePath: string): Promise<string> {
  const raw = readFileSync(filePath, 'latin1')
  const text = parseRtf(raw)
  if (!text.trim()) {
    throw new Error('RTF 文档解析后内容为空，请在编辑器中另存为 DOCX 或 PDF 后重试')
  }
  console.log(`[文档解析] RTF 提取完成: ${text.length} 字符`)
  return text
}

/** 这些控制性分组（destination）只含元数据，不属于正文，整段跳过 */
const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
  'themedata', 'colorschememapping', 'latentstyles', 'datastore',
  'generator', 'listtable', 'listoverridetable', 'rsidtbl',
  'mmathPr', 'wgrffmtfilter', 'xmlnstbl', 'fldinst',
])

/**
 * 把 RTF 源串解析为纯文本。
 *
 * 逐字符扫描，用 depth 跟踪分组层级；遇到 \*\<dest> 或已知的控制性
 * destination 时记录其所在层级，跳过该层级内的所有内容直到分组闭合。
 */
function parseRtf(rtf: string): string {
  let out = ''
  let depth = 0
  // 当前 skip 分组的起始 brace 层级；-1 表示未处于 skip 状态。
  // 用单一值而非计数栈：一旦进入 skip，就忽略其内部所有重复的 skip 标记
  // （例如 `{\*\generator ...}` 中 `\*` 与已知 destination `\generator` 会
  // 各想标记一次），直到引发 skip 的那个分组闭合才解除——从根上避免“多次
  // 标记、单次解除”导致的 skip 状态泄漏（会吞掉其后全部正文）。
  let skipDepth = -1
  // \ucN 指定每个 \uN 之后需要跳过的回退字符数，默认 1。
  let uc = 1
  let i = 0

  const isSkipping = () => skipDepth >= 0

  // 跳过 \uN 之后的 uc 个回退 token（一个 \'xx、一个转义字符或一个普通字符各算一个）
  const skipUnicodeFallback = () => {
    if (rtf[i] === ' ') i++ // 控制字与回退字符间的分隔空格
    let remaining = uc
    while (remaining > 0 && i < rtf.length) {
      if (rtf[i] === '{' || rtf[i] === '}') break // 不吞分组定界符
      if (rtf[i] === '\\' && rtf[i + 1] === '\'') i += 4 // \'xx
      else if (rtf[i] === '\\' && (rtf[i + 1] === '{' || rtf[i + 1] === '}' || rtf[i + 1] === '\\')) i += 2
      else i += 1
      remaining--
    }
  }

  while (i < rtf.length) {
    const ch = rtf[i]

    if (ch === '{') {
      depth++
      i++
      continue
    }

    if (ch === '}') {
      depth--
      // 退出引发 skip 的分组层级时解除 skip
      if (isSkipping() && depth < skipDepth) skipDepth = -1
      i++
      continue
    }

    if (ch === '\\') {
      const next = rtf[i + 1]

      // 转义字符 \{ \} \\
      if (next === '{' || next === '}' || next === '\\') {
        if (!isSkipping()) out += next
        i += 2
        continue
      }

      // \* 标记当前分组为可忽略的 destination（仅在尚未 skip 时记录层级）
      if (next === '*') {
        if (!isSkipping()) skipDepth = depth
        i += 2
        continue
      }

      // \uN 或 \uN- ：Unicode 字符（后跟 uc 个回退字符）
      const uMatch = /^\\u(-?\d+)/.exec(rtf.slice(i))
      if (uMatch) {
        if (!isSkipping()) {
          let code = parseInt(uMatch[1]!, 10)
          if (code < 0) code += 65536
          out += String.fromCharCode(code)
        }
        i += uMatch[0].length
        skipUnicodeFallback()
        continue
      }

      // \'xx ：单字节十六进制字符
      const hexMatch = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(i))
      if (hexMatch) {
        if (!isSkipping()) out += String.fromCharCode(parseInt(hexMatch[1]!, 16))
        i += hexMatch[0].length
        continue
      }

      // 普通控制字：\word 后可跟可选数字参数，再跟可选的一个空格分隔符
      const wordMatch = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i))
      if (wordMatch) {
        const word = wordMatch[1]!
        if (word === 'uc') {
          // 即便处于 skip 状态也要跟踪 uc，确保退出 skip 后回退跳过仍准确
          const n = parseInt(wordMatch[2] ?? '1', 10)
          if (!Number.isNaN(n) && n >= 0) uc = n
        } else if (RTF_SKIP_DESTINATIONS.has(word)) {
          if (!isSkipping()) skipDepth = depth
        } else if (!isSkipping()) {
          if (word === 'par' || word === 'pard' || word === 'line' || word === 'sect' || word === 'page') {
            out += '\n'
          } else if (word === 'tab' || word === 'cell') {
            out += '\t'
          } else if (word === 'row' || word === 'trowd') {
            out += '\n'
          }
        }
        i += wordMatch[0].length
        continue
      }

      // 落单的反斜杠
      i++
      continue
    }

    // 普通字符
    if (!isSkipping()) {
      if (ch === '\n' || ch === '\r') {
        // RTF 源里的裸换行无意义，忽略
      } else {
        out += ch
      }
    }
    i++
  }

  return out
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

interface MammothModule {
  extractRawText(input: { path?: string, buffer?: Buffer }): Promise<{ value: string }>
}

interface OfficeParserModule {
  parseOfficeAsync(file: string | Buffer): Promise<string>
}

async function extractDocxWithMammoth(filePath: string): Promise<string> {
  const mammoth = await import('mammoth') as unknown as MammothModule
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

interface PdfJsModule {
  getDocument(src: {
    data: Uint8Array
    disableFontFace?: boolean
    isEvalSupported?: boolean
    useWorkerFetch?: boolean
  }): PdfLoadingTask
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>
}

interface PdfDocument {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPage>
  destroy(): Promise<void> | void
}

interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>
}

interface PdfTextItem {
  str: string
  hasEOL?: boolean
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === 'object'
    && item !== null
    && 'str' in item
    && typeof (item as { str: unknown }).str === 'string'
  )
}

async function extractPdfWithPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfJsModule
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  })
  const pdf = await loadingTask.promise

  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageParts: string[] = []
      for (const item of content.items) {
        if (!isPdfTextItem(item)) continue
        pageParts.push(item.str)
        if (item.hasEOL) pageParts.push('\n')
      }
      pages.push(pageParts.join(' ').replace(/[ \t]+\n/g, '\n').trim())
    }
    return pages.filter(Boolean).join('\n\n')
  } finally {
    await pdf.destroy()
  }
}

/**
 * 从附件相对路径提取文本（IPC 层使用）
 *
 * 将附件的 localPath（如 {conversationId}/{uuid}.ext）
 * 解析为完整路径后提取文本。
 *
 * @param localPath 附件相对路径
 * @returns 提取的纯文本内容
 */
export async function extractTextFromAttachment(localPath: string): Promise<string> {
  const fullPath = resolveAttachmentPath(localPath)
  return extractTextFromFile(fullPath)
}
