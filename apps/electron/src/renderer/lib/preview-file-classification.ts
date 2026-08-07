/**
 * 预览面板的文件分类。
 *
 * 此处只描述 renderer 的展示和编辑能力，和主进程“能否抽取附件文本”分开维护。
 * 图片、Office 和 PDF 等专用预览类型优先于文本编辑，避免同一文件落入冲突状态。
 */
export type PreviewFileKind = 'markdown' | 'text' | 'pdf' | 'docx' | 'office' | 'legacy-office' | 'image' | 'other'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const TEXT_EDIT_EXTENSIONS = new Set([
  '.txt', '.text', '.log',
  '.csv', '.json', '.jsonc', '.xml', '.html', '.htm', '.xhtml',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw', '.rb', '.rs', '.go', '.java', '.kt', '.kts',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.swift',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
  '.css', '.scss', '.sass', '.less', '.sql', '.graphql', '.gql',
  '.env', '.vue', '.svelte', '.r', '.rmd', '.php', '.dart', '.lua',
  '.zig', '.tf', '.hcl', '.proto', '.lock', '.dockerfile',
])
const TEXT_EDIT_BASENAMES = new Set([
  '.gitignore', '.env', 'dockerfile', 'makefile', 'license', 'changelog',
  'readme', 'authors', 'contributors',
])
const PDF_EXTENSIONS = new Set(['.pdf'])
const DOCX_EXTENSIONS = new Set(['.docx'])
const OFFICE_EXTENSIONS = new Set(['.xlsx', '.pptx'])
const LEGACY_OFFICE_EXTENSIONS = new Set(['.doc', '.xls', '.ppt'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

/** 自动进入编辑的最大文本长度；超过此阈值仍可由用户手动编辑。 */
export const MAX_AUTO_EDIT_CHARS = 500_000

export interface PreviewFileClassification {
  extension: string
  kind: PreviewFileKind
}

export function classifyPreviewFile(filePath: string): PreviewFileClassification {
  const basename = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const dot = basename.lastIndexOf('.')
  const extension = dot >= 0 ? basename.slice(dot) : ''

  // 专用预览优先：SVG 等格式即使是 XML，也保持图片预览而不显示无效编辑态。
  if (IMAGE_EXTENSIONS.has(extension)) return { extension, kind: 'image' }
  if (PDF_EXTENSIONS.has(extension)) return { extension, kind: 'pdf' }
  if (DOCX_EXTENSIONS.has(extension)) return { extension, kind: 'docx' }
  if (OFFICE_EXTENSIONS.has(extension)) return { extension, kind: 'office' }
  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) return { extension, kind: 'legacy-office' }
  if (MARKDOWN_EXTENSIONS.has(extension)) return { extension, kind: 'markdown' }
  if (TEXT_EDIT_EXTENSIONS.has(extension) || TEXT_EDIT_BASENAMES.has(basename)) {
    return { extension, kind: 'text' }
  }
  return { extension, kind: 'other' }
}

export function isEditablePreviewText(kind: PreviewFileKind): boolean {
  return kind === 'markdown' || kind === 'text'
}

export function shouldAutoEnterTextEdit(options: {
  enabled: boolean
  readOnly: boolean
  editable: boolean
  contentLength: number
}): boolean {
  return options.enabled
    && !options.readOnly
    && options.editable
    && options.contentLength <= MAX_AUTO_EDIT_CHARS
}
