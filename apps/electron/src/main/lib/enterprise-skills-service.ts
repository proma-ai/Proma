/**
 * 企业 Skills服务。所有远端请求和制品文件操作均在 Electron 主进程执行。
 * Renderer 只接收 DTO，永远不会接触 JWT、预签名 URL 或本地制品路径。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { getCloudApiConfig } from '@proma/cloud'
import type {
  EnterpriseSkill,
  EnterpriseSkillCheckUpdatesResponse,
  EnterpriseSkillDetail,
  EnterpriseSkillDownload,
  EnterpriseSkillInstallResult,
  EnterpriseSkillListResponse,
  EnterpriseSkillPublishInput,
  EnterpriseSkillVersion,
  EnterpriseSkillSource,
  EnterpriseSkillsAvailability,
  SkillMeta,
} from '@proma/shared'
import { getAuthToken, getApiClient, getCloudSessionRevision, tryRefreshAuthToken } from './cloud-auth-service'
import { getDefaultSkillsDir, getInactiveSkillsDir, getWorkspaceSkillsDir } from './config-paths'

const API_PATH = '/enterprise/skills'
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 30 * 1024 * 1024
const MAX_FILES = 200
const SOURCE_FILE = '.source.json'
const BLOCKED_FILE_NAMES = new Set(['.env', '.npmrc', '.pypirc', 'id_rsa', 'id_ed25519', 'credentials.json'])

export class EnterpriseSkillsError extends Error {
  constructor(message: string, readonly code: 'UNAVAILABLE' | 'VALIDATION' | 'CONFLICT' | 'INTEGRITY' | 'NETWORK' = 'NETWORK') {
    super(message)
    this.name = 'EnterpriseSkillsError'
  }
}

function apiErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return '企业 Skills 服务暂时不可用'
}

function isSafeArchivePath(name: string): boolean {
  const normalized = name.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false
  const target = resolve('/enterprise-skill', normalized)
  return relative('/enterprise-skill', target) !== '' && !relative('/enterprise-skill', target).startsWith('..')
}

function assertSafeSkillSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    throw new EnterpriseSkillsError('Skill 标识不合法', 'VALIDATION')
  }
}

function assertNoSensitiveFile(relativePath: string): void {
  const lower = relativePath.toLowerCase()
  const name = basename(lower)
  if (BLOCKED_FILE_NAMES.has(name) || lower.includes('/.ssh/') || lower.includes('/.aws/') || /\.(pem|key|p12|pfx)$/i.test(name)) {
    throw new EnterpriseSkillsError(`制品包含禁止上传的敏感文件: ${relativePath}`, 'VALIDATION')
  }
}

function sha256(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

function walkSkillFiles(root: string, current = root, files: Array<{ absolutePath: string; relativePath: string }> = []): Array<{ absolutePath: string; relativePath: string }> {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === SOURCE_FILE) continue
    const absolutePath = join(current, entry.name)
    const relativePath = relative(root, absolutePath).split(/\\/).join('/')
    if (entry.isSymbolicLink()) throw new EnterpriseSkillsError(`不允许符号链接: ${relativePath}`, 'VALIDATION')
    if (entry.isDirectory()) {
      walkSkillFiles(root, absolutePath, files)
      continue
    }
    if (!entry.isFile()) continue
    assertNoSensitiveFile(relativePath)
    files.push({ absolutePath, relativePath })
    if (files.length > MAX_FILES) throw new EnterpriseSkillsError(`Skill 文件数超过 ${MAX_FILES} 个`, 'VALIDATION')
  }
  return files
}

/** 将本地 Skill 目录打包；不会包含本地来源元数据或符号链接。 */
export function createEnterpriseSkillArtifact(skillDir: string): Buffer {
  if (!existsSync(join(skillDir, 'SKILL.md'))) throw new EnterpriseSkillsError('Skill 缺少 SKILL.md', 'VALIDATION')
  const zip = new AdmZip()
  let totalSize = 0
  for (const file of walkSkillFiles(skillDir)) {
    const contents = readFileSync(file.absolutePath)
    totalSize += contents.length
    if (totalSize > MAX_EXTRACTED_BYTES) throw new EnterpriseSkillsError('Skill 解压后大小超过 30 MB', 'VALIDATION')
    zip.addFile(file.relativePath, contents)
  }
  const artifact = zip.toBuffer()
  if (artifact.length > MAX_ARCHIVE_BYTES) throw new EnterpriseSkillsError('Skill 压缩包超过 10 MB', 'VALIDATION')
  return artifact
}

/** 严格解压 ZIP；拒绝路径穿越、链接、超限和缺失 SKILL.md。 */
export function extractEnterpriseSkillArtifact(artifact: Buffer, destination: string): { fileCount: number; manifestSha256: string } {
  if (artifact.length === 0 || artifact.length > MAX_ARCHIVE_BYTES) throw new EnterpriseSkillsError('制品大小无效或超过 10 MB', 'INTEGRITY')
  const zip = new AdmZip(artifact)
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory)
  if (entries.length === 0 || entries.length > MAX_FILES) throw new EnterpriseSkillsError(`制品文件数必须为 1-${MAX_FILES}`, 'INTEGRITY')
  const seen = new Set<string>()
  let totalSize = 0
  const manifest: Array<{ path: string; size: number; sha256: string }> = []
  for (const entry of entries) {
    // ZIP 的 UNIX file type 位位于外部属性的高 16 位；链接没有可验证的普通文件内容。
    if (((entry.attr >>> 16) & 0o170000) === 0o120000) {
      throw new EnterpriseSkillsError(`制品包含符号链接: ${entry.entryName}`, 'INTEGRITY')
    }
    const entryName = entry.entryName.replace(/\\/g, '/')
    if (!isSafeArchivePath(entryName) || entryName.startsWith('__MACOSX/')) throw new EnterpriseSkillsError(`制品存在非法路径: ${entry.entryName}`, 'INTEGRITY')
    const lower = entryName.toLowerCase()
    if (seen.has(lower)) throw new EnterpriseSkillsError(`制品存在重复路径: ${entryName}`, 'INTEGRITY')
    seen.add(lower)
    assertNoSensitiveFile(entryName)
    const contents = entry.getData()
    totalSize += contents.length
    if (totalSize > MAX_EXTRACTED_BYTES) throw new EnterpriseSkillsError('制品解压后超过 30 MB', 'INTEGRITY')
    const output = join(destination, entryName)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, contents)
    manifest.push({ path: entryName, size: contents.length, sha256: sha256(contents) })
  }
  if (!seen.has('skill.md')) throw new EnterpriseSkillsError('制品缺少 SKILL.md', 'INTEGRITY')
  manifest.sort((a, b) => a.path.localeCompare(b.path))
  return { fileCount: entries.length, manifestSha256: sha256(Buffer.from(JSON.stringify(manifest))) }
}

function readSource(skillDir: string): EnterpriseSkillSource | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(skillDir, SOURCE_FILE), 'utf-8')) as EnterpriseSkillSource
    return parsed.type === 'enterprise-library' && parsed.schemaVersion === 2 ? parsed : undefined
  } catch { return undefined }
}

function findSkillDir(workspaceSlug: string, slug: string): string | undefined {
  const active = join(getWorkspaceSkillsDir(workspaceSlug), slug)
  if (existsSync(active)) return active
  const inactive = join(getInactiveSkillsDir(workspaceSlug), slug)
  return existsSync(inactive) ? inactive : undefined
}

/** 发布成功后把本地副本标记为该企业版本；之后可继续手动迭代并推送更新。 */
function savePublishedEnterpriseSource(input: {
  skillDir: string
  enterpriseId: string
  skillId: string
  version: EnterpriseSkillVersion
}): void {
  const previous = readSource(input.skillDir)
  const source: EnterpriseSkillSource = {
    schemaVersion: 2,
    type: 'enterprise-library',
    enterpriseId: input.enterpriseId,
    skillId: input.skillId,
    versionId: input.version.id,
    installedVersion: input.version.version,
    artifactSha256: input.version.artifactSha256 ?? previous?.artifactSha256 ?? '',
    baseManifestSha256: calculateSkillManifest(input.skillDir),
    installedAt: previous?.installedAt ?? new Date().toISOString(),
  }
  writeFileSync(join(input.skillDir, SOURCE_FILE), JSON.stringify(source, null, 2), 'utf-8')
}

async function authenticatedFetch(path: string, init: RequestInit): Promise<Response> {
  const revision = getCloudSessionRevision()
  const request = async (token: string | null): Promise<Response> => fetch(`${getCloudApiConfig().baseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  let response = await request(getAuthToken())
  if (response.status === 401) {
    const token = await tryRefreshAuthToken(revision)
    if (token && revision === getCloudSessionRevision()) response = await request(token)
  }
  if (revision !== getCloudSessionRevision()) throw new EnterpriseSkillsError('Cloud 账号已切换，请重试', 'NETWORK')
  return response
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => undefined) as { detail?: string; message?: string } | undefined
    throw new EnterpriseSkillsError(data?.detail ?? data?.message ?? `请求失败 (${response.status})`, response.status === 403 || response.status === 404 ? 'UNAVAILABLE' : 'NETWORK')
  }
  return response.json() as Promise<T>
}

export async function getEnterpriseSkills(): Promise<EnterpriseSkillListResponse> {
  try {
    return (await getApiClient().get<EnterpriseSkillListResponse>(API_PATH)).data
  } catch (error) {
    // API 尚未部署或企业未启用时返回安全的可渲染降级，不抛到 Renderer。
    return { items: [], availability: { enabled: false, reason: apiErrorMessage(error) } }
  }
}

export async function getEnterpriseSkill(skillId: string): Promise<EnterpriseSkillDetail> {
  try { return (await getApiClient().get<EnterpriseSkillDetail>(`${API_PATH}/${encodeURIComponent(skillId)}`)).data }
  catch (error) { throw new EnterpriseSkillsError(apiErrorMessage(error), 'UNAVAILABLE') }
}

export async function publishEnterpriseSkill(workspaceSlug: string, input: EnterpriseSkillPublishInput): Promise<EnterpriseSkillDetail> {
  assertSafeSkillSlug(input.skillSlug)
  const skillDir = findSkillDir(workspaceSlug, input.skillSlug)
  if (!skillDir) throw new EnterpriseSkillsError('本地 Skill 不存在', 'VALIDATION')
  const artifact = createEnterpriseSkillArtifact(skillDir)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(artifact).buffer], { type: 'application/zip' }), 'artifact.zip')
  form.append('slug', input.skillSlug)
  form.append('version', input.version)
  form.append('changelog', input.changelog ?? '')
  if (input.name) form.append('name', input.name)
  if (input.description) form.append('description', input.description)
  const response = await authenticatedFetch(API_PATH, { method: 'POST', body: form })
  const published = await parseResponse<EnterpriseSkillDetail>(response)
  const enterpriseId = published.policy?.enterpriseId
  if (enterpriseId) {
    savePublishedEnterpriseSource({ skillDir, enterpriseId, skillId: published.id, version: published.latestVersion })
  }
  return published
}

export async function publishEnterpriseSkillVersion(workspaceSlug: string, skillId: string, input: Omit<EnterpriseSkillPublishInput, 'skillSlug'> & { skillSlug: string }): Promise<EnterpriseSkillVersion> {
  assertSafeSkillSlug(input.skillSlug)
  const skillDir = findSkillDir(workspaceSlug, input.skillSlug)
  if (!skillDir) throw new EnterpriseSkillsError('本地 Skill 不存在', 'VALIDATION')
  const form = new FormData()
  const artifact = createEnterpriseSkillArtifact(skillDir)
  form.append('file', new Blob([new Uint8Array(artifact).buffer], { type: 'application/zip' }), 'artifact.zip')
  form.append('version', input.version)
  form.append('changelog', input.changelog ?? '')
  const response = await authenticatedFetch(`${API_PATH}/${encodeURIComponent(skillId)}/versions`, { method: 'POST', body: form })
  const published = await parseResponse<EnterpriseSkillVersion>(response)
  const source = readSource(skillDir)
  if (source?.skillId === skillId) {
    savePublishedEnterpriseSource({ skillDir, enterpriseId: source.enterpriseId, skillId, version: published })
  }
  return published
}

type DownloadedEnterpriseSkillArtifact = EnterpriseSkillDownload & { artifact: Buffer }

async function downloadArtifact(skillId: string, versionId: string): Promise<DownloadedEnterpriseSkillArtifact> {
  const descriptor = await getApiClient().post<EnterpriseSkillDownload>(`${API_PATH}/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/download`)
  const download = descriptor.data
  if (!download.url || !/^[a-fA-F0-9]{64}$/.test(download.artifactSha256)) throw new EnterpriseSkillsError('服务端返回的制品信息无效', 'INTEGRITY')
  const response = await fetch(download.url)
  if (!response.ok) throw new EnterpriseSkillsError(`制品下载失败 (${response.status})`, 'NETWORK')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_ARCHIVE_BYTES || sha256(buffer) !== download.artifactSha256.toLowerCase()) throw new EnterpriseSkillsError('制品完整性校验失败', 'INTEGRITY')
  return { ...download, artifact: buffer }
}

/** 下载、校验、安全解压后原子替换本地 Skill。禁止覆盖内置或不同来源同 slug 的 Skill。 */
export async function installEnterpriseSkill(workspaceSlug: string, skill: Pick<EnterpriseSkill, 'id' | 'slug' | 'enterpriseId' | 'latestVersion'>): Promise<EnterpriseSkillInstallResult> {
  assertSafeSkillSlug(skill.slug)
  if (getDefaultSkillSlugs().includes(skill.slug)) throw new EnterpriseSkillsError('不能覆盖 PROMA 内置 Skill', 'CONFLICT')
  const existing = findSkillDir(workspaceSlug, skill.slug)
  const existingSource = existing ? readSource(existing) : undefined
  if (existing && (!existingSource || existingSource.skillId !== skill.id)) throw new EnterpriseSkillsError('已有同名 Skill 且来源不同，请先手动处理冲突', 'CONFLICT')
  // 列表 DTO 可不暴露 enterpriseId；安装时从详情策略补齐来源追踪需要的租户标识。
  const enterpriseId = skill.enterpriseId ?? existingSource?.enterpriseId ?? (await getEnterpriseSkill(skill.id)).policy?.enterpriseId
  if (!enterpriseId) throw new EnterpriseSkillsError('服务端未返回企业标识，无法安全安装', 'UNAVAILABLE')
  const download = await downloadArtifact(skill.id, skill.latestVersion.id)
  const skillsDir = existing ? dirname(existing) : getWorkspaceSkillsDir(workspaceSlug)
  mkdirSync(skillsDir, { recursive: true })
  const staging = join(skillsDir, `.${skill.slug}.enterprise-${randomUUID()}`)
  const backup = join(skillsDir, `.${skill.slug}.backup-${randomUUID()}`)
  try {
    const extracted = extractEnterpriseSkillArtifact(download.artifact, staging)
    const source: EnterpriseSkillSource = {
      schemaVersion: 2, type: 'enterprise-library', enterpriseId, skillId: skill.id,
      versionId: skill.latestVersion.id, installedVersion: skill.latestVersion.version, artifactSha256: download.artifactSha256.toLowerCase(),
      baseManifestSha256: extracted.manifestSha256, installedAt: new Date().toISOString(),
    }
    writeFileSync(join(staging, SOURCE_FILE), JSON.stringify(source, null, 2), 'utf-8')
    if (existing) {
      // A local change is deliberately never silently overwritten.
      if (existingSource?.baseManifestSha256 && existingSource.baseManifestSha256 !== calculateSkillManifest(existing)) {
        throw new EnterpriseSkillsError('本地 Skill 已修改，拒绝自动覆盖', 'CONFLICT')
      }
      rmSync(backup, { recursive: true, force: true })
      rename(existing, backup)
    }
    rename(staging, existing ?? join(skillsDir, skill.slug))
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true })
    return { skillId: skill.id, versionId: skill.latestVersion.id, installedVersion: skill.latestVersion.version, source }
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    if (existsSync(backup) && !existsSync(existing ?? '')) rename(backup, existing ?? join(skillsDir, skill.slug))
    throw error
  }
}

function getDefaultSkillSlugs(): string[] {
  try {
    return readdirSync(getDefaultSkillsDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch { return [] }
}

function rename(from: string, to: string): void {
  // Windows can briefly hold directory handles, but rename is still atomic when it succeeds.
  renameSync(from, to)
}

/** 计算本地文件清单 hash，供安装前修改保护使用。 */
export function calculateSkillManifest(skillDir: string): string {
  const manifest = walkSkillFiles(skillDir)
    .filter((file) => file.relativePath !== SOURCE_FILE)
    .map((file) => ({ path: file.relativePath, size: statSync(file.absolutePath).size, sha256: sha256(readFileSync(file.absolutePath)) }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return sha256(Buffer.from(JSON.stringify(manifest)))
}

export async function checkEnterpriseSkillUpdates(workspaceSlug: string, skills: SkillMeta[]): Promise<EnterpriseSkillCheckUpdatesResponse> {
  const installed = skills.flatMap((skill) => {
    const dir = findSkillDir(workspaceSlug, skill.slug)
    const source = dir ? readSource(dir) : undefined
    return source ? [{ skillId: source.skillId, versionId: source.versionId, version: source.installedVersion }] : []
  })
  if (installed.length === 0) return { updates: [] }
  try { return (await getApiClient().post<EnterpriseSkillCheckUpdatesResponse>(`${API_PATH}/check-updates`, { installed })).data }
  catch { return { updates: [] } }
}

export function getEnterpriseSkillsAvailability(response: EnterpriseSkillListResponse): EnterpriseSkillsAvailability {
  return response.availability ?? { enabled: true, canPublish: false }
}
