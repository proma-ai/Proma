import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  VaultCandidate,
  VaultConfig,
  VaultDeleteInput,
  VaultFileEntry,
  VaultFocus,
  VaultReadResult,
  VaultRenameInput,
  VaultSavePastedImageInput,
  VaultSummary,
  VaultWriteInput,
  VaultWriteResult,
} from '@proma/shared'
import { getDefaultVaultDir, getVaultConfigPath, resolveDefaultVaultDir } from './config-paths'
import { readJsonFileSafe, writeJsonFileAtomic, writeTextFileAtomic } from './safe-file'
import { isValidImageBytes } from './image-content-validation'

const MAX_VAULT_FILE_BYTES = 2 * 1024 * 1024
const MAX_VAULT_FILES = 5_000
const MAX_VAULT_DEPTH = 16
const HIDDEN_DIRECTORY_PREFIX = '.'
const MAX_VAULT_PASTED_IMAGE_BYTES = 10 * 1024 * 1024
// Reject oversize renderer IPC before decoding into an additional Node Buffer.
const MAX_VAULT_PASTED_IMAGE_BASE64_CHARS = Math.ceil(MAX_VAULT_PASTED_IMAGE_BYTES / 3) * 4
const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function normalizeRelativeMarkdownPath(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new Error('Vault 相对路径不能为空')
  }
  if (isAbsolute(value) || isWindowsAbsolutePath(value)) {
    throw new Error('Vault 不接受绝对路径')
  }

  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith(HIDDEN_DIRECTORY_PREFIX))) {
    throw new Error('Vault 路径不能包含隐藏目录、空段或上级目录')
  }
  if (!normalized.toLowerCase().endsWith('.md')) {
    throw new Error('Vault 仅支持 Markdown (.md) 文件')
  }
  return parts.join('/')
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const fromRoot = relative(rootPath, targetPath)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function normalizeRelativeVaultFolderPath(value: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new Error('Vault 文件夹路径非法')
  }
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized) return ''
  if (isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) {
    throw new Error('Vault 不接受绝对路径')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith(HIDDEN_DIRECTORY_PREFIX))) {
    throw new Error('Vault 文件夹路径不能包含隐藏目录、空段或上级目录')
  }
  return parts.join('/')
}

function assertVaultRoot(rootPath: string): string {
  const resolved = realpathSync(resolve(rootPath))
  if (!statSync(resolved).isDirectory()) {
    throw new Error('Vault 根路径不是目录')
  }
  return resolved
}

function getSafeVaultPath(rootPath: string, relativePath: string): { absolutePath: string; relativePath: string } {
  const absolutePath = resolve(rootPath, relativePath)
  if (!isWithinRoot(rootPath, absolutePath)) {
    throw new Error('Vault 路径超出授权根目录')
  }

  let current = rootPath
  for (const segment of relativePath.split('/').filter(Boolean)) {
    current = join(current, segment)
    if (!existsSync(current)) continue
    const stats = lstatSync(current)
    if (stats.isSymbolicLink()) {
      throw new Error('Vault 不允许通过软链接访问文件')
    }
  }

  return { absolutePath, relativePath }
}

function getSafeVaultTarget(rootPath: string, relativePath: string): { absolutePath: string; relativePath: string } {
  return getSafeVaultPath(rootPath, normalizeRelativeMarkdownPath(relativePath))
}

function getSafeVaultFolderTarget(rootPath: string, relativePath: string): { absolutePath: string; relativePath: string } {
  return getSafeVaultPath(rootPath, normalizeRelativeVaultFolderPath(relativePath))
}

function toRelativePath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).split(/[/\\]/).join('/')
}



function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function untitledNoteFilename(date: Date, sequence: number): string {
  const suffix = sequence === 1 ? '' : ` ${sequence}`
  return `Untitled ${formatLocalDate(date)}${suffix}.md`
}

function createFileExclusively(filePath: string, content: string): boolean {
  let descriptor: number | undefined
  try {
    descriptor = openSync(filePath, 'wx')
    writeFileSync(descriptor, content, 'utf-8')
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return false
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export interface VaultUserContextSnapshot {
  rootPath: string
  displayName: string
  focus: VaultFocus
  openedAt: number
}

const vaultUserContextBySession = new Map<string, VaultUserContextSnapshot>()

function normalizeVaultFocus(rootPath: string, focus: VaultFocus): VaultFocus {
  if (!focus || (focus.kind !== 'file' && focus.kind !== 'folder') || !Number.isSafeInteger(focus.sequence) || focus.sequence < 0) {
    throw new Error('Vault focus 非法')
  }
  const target = focus.kind === 'file'
    ? getSafeVaultTarget(rootPath, focus.relativePath)
    : getSafeVaultFolderTarget(rootPath, focus.relativePath)
  if (!existsSync(target.absolutePath)) throw new Error('Vault focus 目标不存在')
  const stats = lstatSync(target.absolutePath)
  if (focus.kind === 'file' ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(`Vault focus 目标不是${focus.kind === 'file' ? ' Markdown 文件' : '文件夹'}`)
  }
  return { kind: focus.kind, relativePath: target.relativePath, sequence: focus.sequence }
}

/**
 * The renderer provides only a relative focus path. Main resolves it against the
 * configured root and rejects stale IPC so one session can never overwrite another.
 */
export function setVaultUserContext(sessionId: string, focus: VaultFocus | null): void {
  if (!sessionId) return
  if (!focus) {
    vaultUserContextBySession.delete(sessionId)
    return
  }
  const config = getVaultConfig()
  if (!config) {
    vaultUserContextBySession.delete(sessionId)
    return
  }
  const previous = vaultUserContextBySession.get(sessionId)
  if (previous && focus.sequence < previous.focus.sequence) return
  vaultUserContextBySession.set(sessionId, {
    rootPath: config.rootPath,
    displayName: config.displayName,
    focus: normalizeVaultFocus(config.rootPath, focus),
    openedAt: Date.now(),
  })
}

export function clearVaultUserContext(sessionId: string): void {
  vaultUserContextBySession.delete(sessionId)
}

export function getVaultUserContext(sessionId: string): VaultUserContextSnapshot | null {
  const context = vaultUserContextBySession.get(sessionId)
  if (!context) return null
  // A later switch to another configured Vault invalidates the previous focus.
  const config = getVaultConfig()
  if (!config || config.rootPath !== context.rootPath) {
    vaultUserContextBySession.delete(sessionId)
    return null
  }
  try {
    return {
      ...context,
      focus: normalizeVaultFocus(context.rootPath, context.focus),
      displayName: config.displayName,
    }
  } catch {
    vaultUserContextBySession.delete(sessionId)
    return null
  }
}

export interface VaultFileSystem {
  listFiles(): VaultFileEntry[]
  readFile(relativePath: string): VaultReadResult
  resolveMedia(noteRelativePath: string, src: string): string | null
  savePastedImage(input: VaultSavePastedImageInput): { src: string } | null
  writeFile(input: VaultWriteInput): VaultWriteResult
  createUntitledNote(inboxPath: string, content?: string, now?: Date): VaultWriteResult
  createUntitledNoteInFolder(folderPath: string, content?: string, now?: Date): VaultWriteResult
  createFolder(relativePath: string): void
  renameFile(input: VaultRenameInput): VaultReadResult
  deleteFile(input: VaultDeleteInput): void
}

/** Creates a bounded filesystem facade for one already-authorized Vault root. */
export function createVaultFileSystem(rootPath: string): VaultFileSystem {
  const root = assertVaultRoot(rootPath)

  const listFiles = (): VaultFileEntry[] => {
    const entries: VaultFileEntry[] = []

    const walk = (currentDir: string, depth: number): void => {
      if (depth > MAX_VAULT_DEPTH || entries.length >= MAX_VAULT_FILES) return
      let dirEntries: import('node:fs').Dirent[]
      try {
        dirEntries = readdirSync(currentDir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of dirEntries) {
        if (entries.length >= MAX_VAULT_FILES || entry.name.startsWith(HIDDEN_DIRECTORY_PREFIX) || entry.isSymbolicLink()) continue
        const absolutePath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          walk(absolutePath, depth + 1)
          continue
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
        try {
          const stats = statSync(absolutePath)
          entries.push({
            relativePath: toRelativePath(root, absolutePath),
            name: entry.name,
            size: stats.size,
            modifiedAt: stats.mtimeMs,
          })
        } catch {
          // 遍历期间文件可能消失或暂时不可访问，跳过后继续处理其他条目。
        }
      }
    }

    walk(root, 0)
    return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  }

  const readFile = (relativePath: string): VaultReadResult => {
    const target = getSafeVaultTarget(root, relativePath)
    if (!existsSync(target.absolutePath)) throw new Error(`Vault 文件不存在: ${target.relativePath}`)
    const stats = lstatSync(target.absolutePath)
    if (!stats.isFile()) throw new Error('Vault 目标不是普通文件')
    if (stats.size > MAX_VAULT_FILE_BYTES) throw new Error('Vault 文件超过 2 MB 读取上限')
    const content = readFileSync(target.absolutePath, 'utf-8')
    return {
      relativePath: target.relativePath,
      content,
      sha256: sha256(content),
      modifiedAt: stats.mtimeMs,
    }
  }

  const resolveMedia = (noteRelativePath: string, src: string): string | null => {
    if (typeof src !== 'string' || !src.trim() || src.includes('\0')) return null
    const note = getSafeVaultTarget(root, noteRelativePath)
    const source = src.trim().replace(/[?#].*$/, '')
    if (!source) return null

    let candidate: string
    try {
      candidate = source.toLowerCase().startsWith('file:')
        ? decodeURIComponent(new URL(source).pathname)
        : resolve(dirname(note.absolutePath), decodeURIComponent(source))
    } catch {
      return null
    }
    if (!isWithinRoot(root, candidate)) return null

    const relativeCandidate = toRelativePath(root, candidate)
    try {
      const target = getSafeVaultPath(root, relativeCandidate)
      return existsSync(target.absolutePath) && lstatSync(target.absolutePath).isFile() ? target.absolutePath : null
    } catch {
      return null
    }
  }

  const savePastedImage = (input: VaultSavePastedImageInput): { src: string } | null => {
    const extension = PASTED_IMAGE_EXTENSIONS[input.mimeType]
    if (!extension || typeof input.base64 !== 'string' || input.base64.length === 0 || input.base64.length > MAX_VAULT_PASTED_IMAGE_BASE64_CHARS) return null
    const normalizedBase64 = input.base64.replace(/\s/g, '')
    if (!normalizedBase64 || normalizedBase64.length > MAX_VAULT_PASTED_IMAGE_BASE64_CHARS || normalizedBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedBase64)) return null

    let data: Buffer
    try {
      data = Buffer.from(normalizedBase64, 'base64')
    } catch {
      return null
    }
    if (data.length === 0 || data.length > MAX_VAULT_PASTED_IMAGE_BYTES || !isValidImageBytes(input.mimeType, data)) return null

    const note = getSafeVaultTarget(root, input.noteRelativePath)
    const directory = dirname(note.relativePath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `pasted-image-${timestamp}-${randomUUID()}.${extension}`
    const mediaRelativePath = directory === '.' ? `assets/${filename}` : `${directory}/assets/${filename}`
    const target = getSafeVaultPath(root, mediaRelativePath)
    mkdirSync(dirname(target.absolutePath), { recursive: true })
    const revalidated = getSafeVaultPath(root, mediaRelativePath)
    writeFileSync(revalidated.absolutePath, data, { flag: 'wx' })
    return { src: toRelativePath(dirname(note.absolutePath), revalidated.absolutePath) }
  }

  const writeFile = (input: VaultWriteInput): VaultWriteResult => {
    if (Buffer.byteLength(input.content, 'utf-8') > MAX_VAULT_FILE_BYTES) {
      throw new Error('Vault 写入内容超过 2 MB 限制')
    }
    const target = getSafeVaultTarget(root, input.relativePath)
    const exists = existsSync(target.absolutePath)
    if (exists) {
      const current = readFile(target.relativePath)
      if (input.createOnly) throw new Error(`Vault 文件已存在: ${target.relativePath}`)
      if (input.expectedSha256 && input.expectedSha256 !== current.sha256) {
        return { ok: false, reason: 'conflict', currentSha256: current.sha256, currentModifiedAt: current.modifiedAt }
      }
    } else if (input.expectedSha256) {
      throw new Error('Vault 文件已不存在，无法按预期版本写入')
    }

    mkdirSync(dirname(target.absolutePath), { recursive: true })
    // Directory creation introduces new ancestors, so validate again before the atomic write.
    const revalidated = getSafeVaultTarget(root, target.relativePath)
    writeTextFileAtomic(revalidated.absolutePath, input.content)
    const result = readFile(revalidated.relativePath)
    return { ok: true, relativePath: result.relativePath, sha256: result.sha256, modifiedAt: result.modifiedAt }
  }

  const createUntitledNote = (inboxPath: string, content = '', now = new Date()): VaultWriteResult => {
    if (Buffer.byteLength(content, 'utf-8') > MAX_VAULT_FILE_BYTES) {
      throw new Error('Vault 写入内容超过 2 MB 限制')
    }
    const normalizedInboxPath = normalizeRelativeMarkdownPath(join(inboxPath, 'placeholder.md')).replace(/\/placeholder\.md$/, '')

    for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence++) {
      const target = getSafeVaultTarget(root, `${normalizedInboxPath}/${untitledNoteFilename(now, sequence)}`)
      mkdirSync(dirname(target.absolutePath), { recursive: true })
      // Directory creation introduces new ancestors, so validate again before exclusive creation.
      const revalidated = getSafeVaultTarget(root, target.relativePath)
      if (!createFileExclusively(revalidated.absolutePath, content)) continue
      const result = readFile(revalidated.relativePath)
      return { ok: true, relativePath: result.relativePath, sha256: result.sha256, modifiedAt: result.modifiedAt }
    }

    throw new Error('Vault 无法分配未命名笔记文件名')
  }

  const createUntitledNoteInFolder = (folderPath: string, content = '', now = new Date()): VaultWriteResult => {
    if (Buffer.byteLength(content, 'utf-8') > MAX_VAULT_FILE_BYTES) {
      throw new Error('Vault 写入内容超过 2 MB 限制')
    }
    const folder = getSafeVaultFolderTarget(root, folderPath)
    if (!existsSync(folder.absolutePath) || !lstatSync(folder.absolutePath).isDirectory()) {
      throw new Error('目标 Vault 文件夹不存在')
    }

    for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence++) {
      const relativePath = folder.relativePath
        ? `${folder.relativePath}/${untitledNoteFilename(now, sequence)}`
        : untitledNoteFilename(now, sequence)
      const target = getSafeVaultTarget(root, relativePath)
      if (!createFileExclusively(target.absolutePath, content)) continue
      const result = readFile(target.relativePath)
      return { ok: true, relativePath: result.relativePath, sha256: result.sha256, modifiedAt: result.modifiedAt }
    }

    throw new Error('Vault 无法分配未命名笔记文件名')
  }

  const createFolder = (relativePath: string): void => {
    const target = getSafeVaultFolderTarget(root, relativePath)
    if (!target.relativePath) throw new Error('不能创建 Vault 根文件夹')
    if (existsSync(target.absolutePath)) throw new Error('同名文件或文件夹已存在')

    const parent = dirname(target.absolutePath)
    if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
      throw new Error('目标 Vault 父文件夹不存在')
    }
    const revalidated = getSafeVaultFolderTarget(root, target.relativePath)
    mkdirSync(revalidated.absolutePath)
  }

  const renameFile = (input: VaultRenameInput): VaultReadResult => {
    const source = getSafeVaultTarget(root, input.relativePath)
    const current = readFile(source.relativePath)
    if (input.expectedSha256 && input.expectedSha256 !== current.sha256) {
      throw new Error('文件已在外部修改，请刷新后再重命名')
    }

    const requestedName = input.name.trim()
    if (!requestedName || requestedName.includes('/') || requestedName.includes('\\') || requestedName.includes('\0')) {
      throw new Error('文件名不能为空且不能包含路径分隔符')
    }
    const filename = requestedName.toLowerCase().endsWith('.md') ? requestedName : `${requestedName}.md`
    const parentPath = source.relativePath.includes('/') ? source.relativePath.slice(0, source.relativePath.lastIndexOf('/')) : ''
    const target = getSafeVaultTarget(root, parentPath ? `${parentPath}/${filename}` : filename)
    if (target.relativePath === source.relativePath) return current
    if (existsSync(target.absolutePath)) throw new Error('同名 Markdown 文件已存在')

    mkdirSync(dirname(target.absolutePath), { recursive: true })
    const revalidatedTarget = getSafeVaultTarget(root, target.relativePath)
    renameSync(source.absolutePath, revalidatedTarget.absolutePath)
    return readFile(revalidatedTarget.relativePath)
  }

  const deleteFile = (input: VaultDeleteInput): void => {
    const target = getSafeVaultTarget(root, input.relativePath)
    if (!existsSync(target.absolutePath)) throw new Error(`Vault 文件不存在: ${target.relativePath}`)
    const stats = lstatSync(target.absolutePath)
    if (!stats.isFile()) throw new Error('Vault 目标不是普通文件')
    if (input.expectedSha256) {
      if (stats.size > MAX_VAULT_FILE_BYTES) throw new Error('Vault 文件超过 2 MB 校验上限')
      const current = readFile(target.relativePath)
      if (input.expectedSha256 !== current.sha256) {
        throw new Error('文件已在外部修改，请刷新后再删除')
      }
    }

    // Revalidate immediately before unlinking so no symlinked ancestor is accepted.
    const revalidated = getSafeVaultTarget(root, target.relativePath)
    const revalidatedStats = lstatSync(revalidated.absolutePath)
    if (!revalidatedStats.isFile()) throw new Error('Vault 目标不是普通文件')
    unlinkSync(revalidated.absolutePath)
  }

  return { listFiles, readFile, resolveMedia, savePastedImage, writeFile, createUntitledNote, createUntitledNoteInFolder, createFolder, renameFile, deleteFile }
}


function parseVaultConfig(value: unknown): VaultConfig | null {
  if (!value || typeof value !== 'object') return null
  const config = value as Record<string, unknown>
  if (
    typeof config.rootPath !== 'string'
    || typeof config.displayName !== 'string'
    || typeof config.inboxPath !== 'string'
    || typeof config.allowAgentWrites !== 'boolean'
    || typeof config.configuredAt !== 'number'
  ) {
    return null
  }
  try {
    const rootPath = assertVaultRoot(config.rootPath)
    return {
      rootPath,
      displayName: config.displayName,
      inboxPath: normalizeRelativeMarkdownPath(join(config.inboxPath, 'placeholder.md')).replace(/\/placeholder\.md$/, ''),
      allowAgentWrites: config.allowAgentWrites,
      configuredAt: config.configuredAt,
    }
  } catch {
    return null
  }
}

export function getVaultConfig(): VaultConfig | null {
  return parseVaultConfig(readJsonFileSafe<unknown>(getVaultConfigPath()))
}

function vaultId(rootPath: string): string {
  // Renderer state needs to distinguish Vaults, but must not receive the
  // user-authorized absolute path. The digest is stable for the canonical root.
  return createHash('sha256').update(rootPath, 'utf-8').digest('hex')
}

export function getVaultSummary(): VaultSummary | null {
  const config = getVaultConfig()
  if (!config) return null
  return {
    vaultId: vaultId(config.rootPath),
    displayName: config.displayName,
    inboxPath: config.inboxPath,
    allowAgentWrites: config.allowAgentWrites,
    configuredAt: config.configuredAt,
  }
}

function vaultSummary(config: VaultConfig): VaultSummary {
  return {
    vaultId: vaultId(config.rootPath),
    displayName: config.displayName,
    inboxPath: config.inboxPath,
    allowAgentWrites: config.allowAgentWrites,
    configuredAt: config.configuredAt,
  }
}

function configureVaultAt(rootPath: string, configPath: string, options: { inboxPath?: string; allowAgentWrites?: boolean } = {}): VaultSummary {
  const root = assertVaultRoot(rootPath)
  const inboxPath = options.inboxPath?.trim() || 'Proma Inbox'
  const normalizedInboxPath = normalizeRelativeMarkdownPath(join(inboxPath, 'placeholder.md')).replace(/\/placeholder\.md$/, '')
  const managedRootPath = resolveDefaultVaultDir(dirname(configPath))
  const isManagedRoot = existsSync(managedRootPath) && root === realpathSync(managedRootPath)
  const config: VaultConfig = {
    rootPath: root,
    displayName: isManagedRoot ? 'Proma Vault' : basename(root) || 'Vault',
    inboxPath: normalizedInboxPath,
    allowAgentWrites: options.allowAgentWrites === true,
    configuredAt: Date.now(),
  }
  writeJsonFileAtomic(configPath, config)
  return vaultSummary(config)
}

export function configureVault(rootPath: string, options: { inboxPath?: string; allowAgentWrites?: boolean } = {}): VaultSummary {
  return configureVaultAt(rootPath, getVaultConfigPath(), options)
}


export function selectDefaultVault(): VaultSummary {
  return configureVault(getDefaultVaultDir(), { inboxPath: 'Proma Inbox', allowAgentWrites: false })
}


export function authorizeDiscoveredVault(rootPath: string, options: { inboxPath?: string; allowAgentWrites?: boolean } = {}): VaultSummary {
  const candidate = discoverObsidianVaultCandidates().find((item) => item.path === rootPath)
  if (!candidate) throw new Error('Vault 候选已失效，请通过系统文件夹选择器重新授权')
  return configureVault(candidate.path, options)
}


export function getConfiguredVaultFileSystem(): VaultFileSystem {
  const config = getVaultConfig()
  if (!config) throw new Error('尚未选择 Vault')
  return createVaultFileSystem(config.rootPath)
}

/** 在已配置 Vault 的 Inbox 中原子创建一个不覆盖既有笔记的未命名 Markdown 文件。 */
export function createUntitledVaultFile(): VaultWriteResult {
  const config = getVaultConfig()
  if (!config) throw new Error('尚未选择 Vault')
  return createVaultFileSystem(config.rootPath).createUntitledNote(config.inboxPath)
}

export function createUntitledVaultFileInFolder(folderPath: string): VaultWriteResult {
  const config = getVaultConfig()
  if (!config) throw new Error('尚未选择 Vault')
  return createVaultFileSystem(config.rootPath).createUntitledNoteInFolder(folderPath)
}

export function createVaultFolder(relativePath: string): void {
  const config = getVaultConfig()
  if (!config) throw new Error('尚未选择 Vault')
  createVaultFileSystem(config.rootPath).createFolder(relativePath)
}

export function discoverVaultCandidates(): VaultCandidate[] {
  const managedRootPath = resolveDefaultVaultDir(dirname(getVaultConfigPath()))
  let managedRoot: string | null = null
  try {
    managedRoot = existsSync(managedRootPath) ? assertVaultRoot(managedRootPath) : null
  } catch {
    managedRoot = null
  }
  const candidates: VaultCandidate[] = managedRoot
    ? [{ path: managedRoot, displayName: 'Proma Vault', isObsidianVault: existsSync(join(managedRoot, '.obsidian')), isPromaManaged: true }]
    : []
  return [...candidates, ...discoverObsidianVaultCandidates()]
}

/**
 * All valid Vault roots are ambient local-file permissions for an Agent run.
 * Obsidian's registry is the source of truth; the selected Proma Vault is also
 * retained for users that have not installed Obsidian.
 */
export function getAgentVaultRoots(): string[] {
  const roots = new Map<string, string>()
  const add = (path: string): void => {
    try {
      const root = assertVaultRoot(path)
      const key = process.platform === 'win32' ? root.toLowerCase() : root
      roots.set(key, root)
    } catch {
      // A stale registry/config entry must never block an Agent run.
    }
  }
  const configured = getVaultConfig()
  if (configured) add(configured.rootPath)
  for (const candidate of discoverVaultCandidates()) add(candidate.path)
  return [...roots.values()]
}

export function discoverObsidianVaultCandidates(): VaultCandidate[] {
  const configPaths = platform() === 'darwin'
    ? [join(homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')]
    : platform() === 'win32'
      ? [join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')]
      : [join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obsidian', 'obsidian.json')]
  const managedRootPath = resolveDefaultVaultDir(dirname(getVaultConfigPath()))
  let managedRoot: string | null = null
  try {
    managedRoot = existsSync(managedRootPath) ? assertVaultRoot(managedRootPath) : null
  } catch {
    managedRoot = null
  }
  const candidates = new Map<string, VaultCandidate>()

  for (const configPath of configPaths) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as { vaults?: Record<string, { path?: unknown }> }
      for (const vault of Object.values(raw.vaults ?? {})) {
        if (typeof vault.path !== 'string' || !vault.path) continue
        try {
          const root = assertVaultRoot(vault.path)
          if (root === managedRoot) continue
          candidates.set(root, {
            path: root,
            displayName: basename(root) || 'Vault',
            isObsidianVault: existsSync(join(root, '.obsidian')),
            isPromaManaged: false,
          })
        } catch {
          // A stale Obsidian registry entry is only a suggestion and can be ignored.
        }
      }
    } catch {
      // Obsidian is optional and its registry should never block the Vault page.
    }
  }
  return [...candidates.values()].sort((left, right) => left.displayName.localeCompare(right.displayName))
}
