/**
 * Agent 工作区管理器
 *
 * 负责 Agent 工作区的 CRUD 操作。
 * - 工作区索引：~/.proma/agent-workspaces.json（轻量元数据）
 * - 工作区目录：~/.proma/agent-workspaces/{slug}/（Agent 的 cwd）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, cpSync, rmSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { writeJsonFileAtomic, readJsonFileSafe } from './safe-file'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  getAgentWorkspacesIndexPath,
  getAgentWorkspacePath,
  getWorkspaceMcpPath,
  getWorkspaceSkillsDir,
  getInactiveSkillsDir,
  getDefaultSkillsDir,
  parseSkillVersion,
} from './config-paths'
import type { AgentWorkspace, WorkspaceMcpConfig, SkillMeta, SkillImportSource, OtherWorkspaceSkillsGroup, WorkspaceCapabilities, PromaPermissionMode } from '@proma/shared'
import { migratePermissionMode } from '@proma/shared'

interface AgentWorkspacesIndex {
  version: number
  workspaces: AgentWorkspace[]
}

const INDEX_VERSION = 2

/** 读取工作区索引文件，自动执行版本迁移 */
function readIndex(): AgentWorkspacesIndex {
  const indexPath = getAgentWorkspacesIndexPath()
  const data = readJsonFileSafe<AgentWorkspacesIndex>(indexPath)

  if (data) {
    // 版本迁移
    if ((data.version ?? 1) < INDEX_VERSION) {
      migrateIndex(data)
    }
    return data
  }

  return { version: INDEX_VERSION, workspaces: [] }
}

function migrateIndex(index: AgentWorkspacesIndex): void {
  const oldVersion = index.version ?? 1

  // v1 → v2: 为所有工作区默认启用 skill-creator
  if (oldVersion < 2) {
    activateSkillCreatorInAllWorkspaces(index)
  }

  index.version = INDEX_VERSION
  writeIndex(index)
  console.log(`[Agent 工作区] 索引已迁移: v${oldVersion} → v${INDEX_VERSION}`)
}

/** v1→v2 迁移：将 skills-inactive/skill-creator 移到 skills/ */
function activateSkillCreatorInAllWorkspaces(index: AgentWorkspacesIndex): void {
  for (const workspace of index.workspaces) {
    const activeDir = getWorkspaceSkillsDir(workspace.slug)
    const inactiveDir = getInactiveSkillsDir(workspace.slug)

    const inactivePath = join(inactiveDir, 'skill-creator')
    const activePath = join(activeDir, 'skill-creator')

    if (existsSync(activePath) || !existsSync(inactivePath)) continue

    try {
      if (!existsSync(activeDir)) {
        mkdirSync(activeDir, { recursive: true })
      }
      renameSync(inactivePath, activePath)
      console.log(`[Agent 工作区] 已为 ${workspace.slug} 启用 skill-creator`)
    } catch (err) {
      console.warn(`[Agent 工作区] 启用 skill-creator 失败 (${workspace.slug}):`, err)
    }
  }
}

function writeIndex(index: AgentWorkspacesIndex): void {
  const indexPath = getAgentWorkspacesIndexPath()

  try {
    writeJsonFileAtomic(indexPath, index)
  } catch (error) {
    console.error('[Agent 工作区] 写入索引文件失败:', error)
    throw new Error('写入 Agent 工作区索引失败')
  }
}

/** 名称转 URL-safe slug，非 ASCII 名称 fallback 为 workspace-{timestamp} */
function slugify(name: string, existingSlugs: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  if (!base) {
    base = `workspace-${Date.now()}`
  }

  let slug = base
  let counter = 1
  while (existingSlugs.has(slug)) {
    slug = `${base}-${counter}`
    counter++
  }

  return slug
}

/** 返回索引中的存储顺序（与 UI 拖拽顺序一致）；返回副本，避免调用方 sort 等操作误改索引数组 */

export function listAgentWorkspaces(): AgentWorkspace[] {
  const index = readIndex()
  return index.workspaces.slice()
}

/** 按 updatedAt 降序（桥接/飞书列表等与旧版内联 sort 一致；渲染进程仍用 listAgentWorkspaces） */
export function listAgentWorkspacesByUpdatedAt(): AgentWorkspace[] {
  const index = readIndex()
  return index.workspaces.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 按指定 ID 顺序重排工作区，未列出的追加到末尾 */
export function reorderAgentWorkspaces(orderedIds: string[]): AgentWorkspace[] {
  const index = readIndex()
  const byId = new Map(index.workspaces.map((w) => [w.id, w]))
  const reordered: AgentWorkspace[] = []
  for (const id of orderedIds) {
    const ws = byId.get(id)
    if (ws) {
      reordered.push(ws)
      byId.delete(id)
    }
  }
  for (const ws of byId.values()) reordered.push(ws)
  index.workspaces = reordered
  writeIndex(index)
  return reordered
}

export function getAgentWorkspace(id: string): AgentWorkspace | undefined {
  const index = readIndex()
  return index.workspaces.find((w) => w.id === id)
}

/** 将 ~/.proma/default-skills/ 复制到工作区 skills/ 目录 */
function copyDefaultSkills(workspaceSlug: string): void {
  const defaultDir = getDefaultSkillsDir()
  const targetDir = getWorkspaceSkillsDir(workspaceSlug)

  try {
    const entries = readdirSync(defaultDir, { withFileTypes: true })
    if (entries.length === 0) return

    cpSync(defaultDir, targetDir, { recursive: true })
    console.log(`[Agent 工作区] 已复制默认 Skills 到: ${workspaceSlug}`)
  } catch {
    // 模板目录不存在，跳过
  }
}

export function createAgentWorkspace(name: string): AgentWorkspace {
  const index = readIndex()

  const duplicate = index.workspaces.find((w) => w.name === name)
  if (duplicate) {
    throw new Error(`工作区名称「${name}」已存在`)
  }

  const existingSlugs = new Set(index.workspaces.map((w) => w.slug))
  const slug = slugify(name, existingSlugs)
  const now = Date.now()

  const workspace: AgentWorkspace = {
    id: randomUUID(),
    name,
    slug,
    createdAt: now,
    updatedAt: now,
  }

  getAgentWorkspacePath(slug)
  ensurePluginManifest(slug, name)
  copyDefaultSkills(slug)

  index.workspaces.unshift(workspace)
  writeIndex(index)

  console.log(`[Agent 工作区] 已创建工作区: ${name} (slug: ${slug})`)
  return workspace
}

/** 更新工作区名称（slug 和目录不变） */
export function updateAgentWorkspace(
  id: string,
  updates: { name: string },
): AgentWorkspace {
  const index = readIndex()
  const idx = index.workspaces.findIndex((w) => w.id === id)

  if (idx === -1) {
    throw new Error(`Agent 工作区不存在: ${id}`)
  }

  const existing = index.workspaces[idx]!

  const duplicate = index.workspaces.find((w) => w.id !== id && w.name === updates.name)
  if (duplicate) {
    throw new Error(`工作区名称「${updates.name}」已存在`)
  }

  const updated: AgentWorkspace = {
    ...existing,
    name: updates.name,
    updatedAt: Date.now(),
  }

  index.workspaces[idx] = updated
  writeIndex(index)

  console.log(`[Agent 工作区] 已更新工作区: ${updated.name} (${updated.id})`)
  return updated
}

/** 删除工作区索引条目，保留目录避免误删用户文件 */
export function deleteAgentWorkspace(id: string): void {
  const index = readIndex()
  const idx = index.workspaces.findIndex((w) => w.id === id)

  if (idx === -1) {
    throw new Error(`Agent 工作区不存在: ${id}`)
  }

  const removed = index.workspaces.splice(idx, 1)[0]!
  writeIndex(index)

  console.log(`[Agent 工作区] 已删除工作区索引: ${removed.name} (slug: ${removed.slug}，目录已保留)`)
}

/** 确保默认工作区存在，首次启动时自动创建（slug: default） */
export function ensureDefaultWorkspace(): AgentWorkspace {
  const index = readIndex()
  let defaultWs = index.workspaces.find((w) => w.slug === 'default')

  if (!defaultWs) {
    const now = Date.now()
    defaultWs = {
      id: randomUUID(),
      name: '默认工作区',
      slug: 'default',
      createdAt: now,
      updatedAt: now,
    }

    getAgentWorkspacePath('default')
    ensurePluginManifest('default', '默认工作区')
    copyDefaultSkills('default')

    index.workspaces.push(defaultWs)
    writeIndex(index)

    console.log('[Agent 工作区] 已创建默认工作区')
  } else {
    // 迁移兼容：确保已有默认工作区包含 plugin manifest
    ensurePluginManifest(defaultWs.slug, defaultWs.name)
  }

  return defaultWs
}

// ===== 默认 Skills 自动升级 =====

/** 将所有工作区中版本过旧的默认 Skill 升级到 ~/.proma/default-skills/ 的最新版本 */
export function upgradeDefaultSkillsInWorkspaces(): void {
  const defaultDir = getDefaultSkillsDir()

  interface DefaultSkillInfo {
    version: string
    sourcePath: string
  }
  const defaultSkills = new Map<string, DefaultSkillInfo>()

  try {
    const entries = readdirSync(defaultDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sourcePath = join(defaultDir, entry.name)
      const version = parseSkillVersion(sourcePath)
      defaultSkills.set(entry.name, { version, sourcePath })
    }
  } catch {
    return
  }

  if (defaultSkills.size === 0) return

  const index = readIndex()

  for (const workspace of index.workspaces) {
    const dirs = [
      getWorkspaceSkillsDir(workspace.slug),
      getInactiveSkillsDir(workspace.slug),
    ]

    for (const dir of dirs) {
      if (!existsSync(dir)) continue

      for (const [slug, info] of defaultSkills) {
        const targetPath = join(dir, slug)
        if (!existsSync(targetPath)) continue

        const currentVer = parseSkillVersion(targetPath)
        if (compareSemver(info.version, currentVer) > 0) {
          cpSync(info.sourcePath, targetPath, { recursive: true, force: true })
          console.log(`[Agent 工作区] 已升级 Skill: ${workspace.slug}/${slug} (${currentVer} → ${info.version})`)
        }
      }
    }
  }
}

/** 比较两个 semver 版本字符串，返回值 >0 表示 a 更新 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ===== Plugin Manifest（SDK 插件发现） =====

/** 确保工作区包含 .claude-plugin/plugin.json，SDK 需要此文件发现 skills */
export function ensurePluginManifest(workspaceSlug: string, workspaceName: string): void {
  const wsPath = getAgentWorkspacePath(workspaceSlug)
  const pluginDir = join(wsPath, '.claude-plugin')
  const manifestPath = join(pluginDir, 'plugin.json')

  if (existsSync(manifestPath)) return

  if (!existsSync(pluginDir)) {
    mkdirSync(pluginDir, { recursive: true })
  }

  const manifest = {
    name: `proma-workspace-${workspaceSlug}`,
    version: '1.0.0',
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`[Agent 工作区] 已创建 plugin manifest: ${workspaceSlug}`)
}

// ===== MCP 配置管理 =====

export function getWorkspaceMcpConfig(workspaceSlug: string): WorkspaceMcpConfig {
  const mcpPath = getWorkspaceMcpPath(workspaceSlug)

  if (!existsSync(mcpPath)) {
    return { servers: {} }
  }

  try {
    const raw = readFileSync(mcpPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceMcpConfig>
    return { servers: parsed.servers ?? {} }
  } catch (error) {
    console.error('[Agent 工作区] 读取 MCP 配置失败:', error)
    return { servers: {} }
  }
}

export function saveWorkspaceMcpConfig(workspaceSlug: string, config: WorkspaceMcpConfig): void {
  const mcpPath = getWorkspaceMcpPath(workspaceSlug)

  try {
    writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8')
    console.log(`[Agent 工作区] 已保存 MCP 配置: ${workspaceSlug}`)
  } catch (error) {
    console.error('[Agent 工作区] 保存 MCP 配置失败:', error)
    throw new Error('保存 MCP 配置失败')
  }
}

// ===== Skill 目录扫描 =====

/** 扫描工作区活跃 Skills，仅返回 skills/ 下的 Skill */
export function getWorkspaceSkills(workspaceSlug: string): SkillMeta[] {
  return scanSkillsInDir(getWorkspaceSkillsDir(workspaceSlug), true)
}

/** 解析 SKILL.md 的 YAML frontmatter，支持单行值、block scalar（`|` / `>`）和多行缩进 */
function parseSkillFrontmatter(content: string, slug: string, enabled: boolean): SkillMeta {
  const meta: SkillMeta = { slug, name: slug, enabled }

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch) return meta

  const yaml = fmMatch[1]
  if (!yaml) return meta

  const validKeys = new Set(['name', 'description', 'icon', 'version'])
  const entries: Record<string, string> = {}
  let currentKey = ''
  let isFolded = false

  for (const line of yaml.split('\n')) {
    const indented = /^\s/.test(line)

    if (!indented) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) { currentKey = ''; continue }

      const key = line.slice(0, colonIdx).trim()
      const raw = line.slice(colonIdx + 1).trim()

      if (!validKeys.has(key)) { currentKey = ''; isFolded = false; continue }

      if (raw === '|' || raw === '>') {
        currentKey = key
        isFolded = raw === '>'
        entries[key] = ''
        continue
      }

      currentKey = key
      isFolded = false
      entries[key] = raw.replace(/^["']|["']$/g, '')
    } else if (currentKey) {
      const text = line.trim()
      if (!text) { if (entries[currentKey]) entries[currentKey] += '\n'; continue }
      const sep = isFolded ? ' ' : '\n'
      entries[currentKey] = entries[currentKey] ? entries[currentKey] + sep + text : text
    }
  }

  if (entries.name) meta.name = entries.name.trim()
  if (entries.description) meta.description = entries.description.trim()
  if (entries.icon) meta.icon = entries.icon.trim()
  if (entries.version) meta.version = entries.version.trim()

  return meta
}

// ===== 工作区能力摘要 =====

export function getWorkspaceCapabilities(workspaceSlug: string): WorkspaceCapabilities {
  const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
  const skills = getWorkspaceSkills(workspaceSlug)

  const mcpServers = Object.entries(mcpConfig.servers ?? {}).map(([name, entry]) => ({
    name,
    enabled: entry.enabled,
    type: entry.type,
  }))

  return { mcpServers, skills }
}

export function deleteWorkspaceSkill(workspaceSlug: string, skillSlug: string): void {
  const skillsDir = getWorkspaceSkillsDir(workspaceSlug)
  const skillPath = join(skillsDir, skillSlug)

  if (!existsSync(skillPath)) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  rmSync(skillPath, { recursive: true, force: true })
  console.log(`[Agent 工作区] 已删除 Skill: ${workspaceSlug}/${skillSlug}`)
}

/** 扫描指定目录下的 Skills，供 getWorkspaceSkills 和 getAllWorkspaceSkills 复用 */
function scanSkillsInDir(dir: string, enabled: boolean): SkillMeta[] {
  const skills: SkillMeta[] = []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(dir, entry.name)).isDirectory())
      if (!isDir) continue

      const skillMdPath = join(dir, entry.name, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue

      try {
        const content = readFileSync(skillMdPath, 'utf-8')
        const meta = parseSkillFrontmatter(content, entry.name, enabled)

        // 如果是导入的 Skill，读取来源信息并检测更新
        const importSource = readSkillImportSource(join(dir, entry.name))
        if (importSource) {
          meta.importSource = importSource
          const sourceSkillDir = resolveSkillDir(importSource.sourceWorkspaceSlug, entry.name)
          if (sourceSkillDir) {
            const currentSourceVersion = parseSkillVersion(sourceSkillDir)
            meta.hasUpdate = isNewerVersion(currentSourceVersion, importSource.sourceVersion)
          }
        }

        skills.push(meta)
      } catch {
        console.warn(`[Agent 工作区] 解析 Skill 失败: ${entry.name}`)
      }
    }
  } catch {
    // 目录可能不存在
  }

  return skills
}

/** 获取工作区所有 Skills（含活跃和不活跃），用于设置页 UI */
export function getAllWorkspaceSkills(workspaceSlug: string): SkillMeta[] {
  const activeSkills = scanSkillsInDir(getWorkspaceSkillsDir(workspaceSlug), true)
  const inactiveSkills = scanSkillsInDir(getInactiveSkillsDir(workspaceSlug), false)
  return [...activeSkills, ...inactiveSkills]
}

/** 在 skills/ 和 skills-inactive/ 之间移动来切换启用/禁用 */
export function toggleWorkspaceSkill(workspaceSlug: string, skillSlug: string, enabled: boolean): void {
  const activeDir = getWorkspaceSkillsDir(workspaceSlug)
  const inactiveDir = getInactiveSkillsDir(workspaceSlug)

  const srcDir = enabled ? inactiveDir : activeDir
  const destDir = enabled ? activeDir : inactiveDir

  const srcPath = join(srcDir, skillSlug)
  const destPath = join(destDir, skillSlug)

  if (!existsSync(srcPath)) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  if (existsSync(destPath)) {
    throw new Error(`目标目录已存在同名 Skill: ${skillSlug}`)
  }

  renameSync(srcPath, destPath)
  console.log(`[Agent 工作区] Skill ${enabled ? '启用' : '禁用'}: ${workspaceSlug}/${skillSlug}`)
}

/**
 * 获取其他工作区的 Skill 列表，按工作区分组返回。
 */
export function getOtherWorkspaceSkills(currentSlug: string): OtherWorkspaceSkillsGroup[] {
  const workspaces = listAgentWorkspaces()
  const result: OtherWorkspaceSkillsGroup[] = []

  for (const workspace of workspaces) {
    if (workspace.slug === currentSlug) continue

    const skills = getAllWorkspaceSkills(workspace.slug)
    if (skills.length === 0) continue

    result.push({
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      skills,
    })
  }

  return result
}

/**
 * 从其他工作区导入 Skill 到当前工作区。
 *
 * 复制目录并记录来源元数据（.source.json），支持后续版本检测和同步更新。
 */
export function importSkillFromWorkspace(
  targetSlug: string,
  sourceSlug: string,
  skillSlug: string,
): SkillMeta {
  const sourcePath = resolveSkillDir(sourceSlug, skillSlug)

  if (!sourcePath) {
    throw new Error(`源工作区中不存在 Skill: ${skillSlug}`)
  }

  // P0 修复：复制前校验源 SKILL.md 存在，避免产生孤立目录
  const sourceSkillMdPath = join(sourcePath, 'SKILL.md')
  if (!existsSync(sourceSkillMdPath)) {
    throw new Error(`源 Skill 缺少 SKILL.md: ${skillSlug}`)
  }

  const targetPath = join(getWorkspaceSkillsDir(targetSlug), skillSlug)
  const targetInactivePath = join(getInactiveSkillsDir(targetSlug), skillSlug)

  if (existsSync(targetPath) || existsSync(targetInactivePath)) {
    throw new Error(`当前工作区已存在同名 Skill: ${skillSlug}`)
  }

  cpSync(sourcePath, targetPath, { recursive: true })

  // 写入来源元数据
  const sourceWorkspace = listAgentWorkspaces().find((w) => w.slug === sourceSlug)
  const importSource: SkillImportSource = {
    sourceWorkspaceSlug: sourceSlug,
    sourceWorkspaceName: sourceWorkspace?.name ?? sourceSlug,
    importedAt: new Date().toISOString(),
    sourceVersion: parseSkillVersion(sourcePath),
  }
  writeSkillImportSource(targetPath, importSource)

  console.log(`[Agent 工作区] 已从 ${sourceSlug} 导入 Skill: ${targetSlug}/${skillSlug}`)

  const content = readFileSync(join(targetPath, 'SKILL.md'), 'utf-8')
  const meta = parseSkillFrontmatter(content, skillSlug, true)
  meta.importSource = importSource
  return meta
}

/**
 * 从源工作区同步更新已导入的 Skill（覆盖更新）。
 *
 * - 源不存在：抛出错误，不修改目标
 * - 本地已禁用（skills-inactive）：在 inactive 目录中原地更新，保留 enabled 状态
 */
export function updateSkillFromSource(
  targetSlug: string,
  skillSlug: string,
): SkillMeta {
  const activeDir = getWorkspaceSkillsDir(targetSlug)
  const inactiveDir = getInactiveSkillsDir(targetSlug)

  const targetPath = existsSync(join(activeDir, skillSlug))
    ? join(activeDir, skillSlug)
    : existsSync(join(inactiveDir, skillSlug))
      ? join(inactiveDir, skillSlug)
      : null

  if (!targetPath) {
    throw new Error(`当前工作区中不存在 Skill: ${skillSlug}`)
  }

  const existingSource = readSkillImportSource(targetPath)
  if (!existingSource) {
    throw new Error(`Skill ${skillSlug} 不是从其他工作区导入的，无法从源更新`)
  }

  const sourcePath = resolveSkillDir(existingSource.sourceWorkspaceSlug, skillSlug)
  if (!sourcePath) {
    throw new Error(`源工作区中不再存在 Skill: ${skillSlug}（来源: ${existingSource.sourceWorkspaceName}）`)
  }

  if (!existsSync(join(sourcePath, 'SKILL.md'))) {
    throw new Error(`源 Skill 缺少 SKILL.md: ${skillSlug}`)
  }

  // 先复制到临时目录，成功后再替换旧目录，确保原子性
  const parentDir = join(targetPath, '..')
  const tmpPath = join(parentDir, `.${skillSlug}.updating`)
  try {
    cpSync(sourcePath, tmpPath, { recursive: true })
  } catch (err) {
    // 复制失败时清理临时目录，保留原目录不变
    if (existsSync(tmpPath)) rmSync(tmpPath, { recursive: true, force: true })
    throw err
  }
  rmSync(targetPath, { recursive: true, force: true })
  renameSync(tmpPath, targetPath)

  // 更新来源元数据（保留原始 importedAt）
  const sourceWorkspace = listAgentWorkspaces().find((w) => w.slug === existingSource.sourceWorkspaceSlug)
  const updatedSource: SkillImportSource = {
    sourceWorkspaceSlug: existingSource.sourceWorkspaceSlug,
    sourceWorkspaceName: sourceWorkspace?.name ?? existingSource.sourceWorkspaceName,
    importedAt: existingSource.importedAt,
    sourceVersion: parseSkillVersion(sourcePath),
  }
  writeSkillImportSource(targetPath, updatedSource)

  const enabled = targetPath === join(activeDir, skillSlug)
  const content = readFileSync(join(targetPath, 'SKILL.md'), 'utf-8')
  const meta = parseSkillFrontmatter(content, skillSlug, enabled)
  meta.importSource = updatedSource
  meta.hasUpdate = false

  console.log(`[Agent 工作区] 已从源更新 Skill: ${targetSlug}/${skillSlug}`)
  return meta
}

// ===== Skill 来源追踪 helpers =====

const SOURCE_META_FILE = '.source.json'

function readSkillImportSource(skillDir: string): SkillImportSource | undefined {
  const p = join(skillDir, SOURCE_META_FILE)
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as SkillImportSource
  } catch {
    return undefined
  }
}

function writeSkillImportSource(skillDir: string, source: SkillImportSource): void {
  writeFileSync(join(skillDir, SOURCE_META_FILE), JSON.stringify(source, null, 2), 'utf-8')
}

/** 解析 Skill 所在目录（active 或 inactive），不存在则返回 null */
function resolveSkillDir(workspaceSlug: string, skillSlug: string): string | null {
  const active = join(getWorkspaceSkillsDir(workspaceSlug), skillSlug)
  if (existsSync(active)) return active
  const inactive = join(getInactiveSkillsDir(workspaceSlug), skillSlug)
  if (existsSync(inactive)) return inactive
  return null
}

/** 简单 semver 比较：a 是否比 b 更新 */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

// ===== 权限模式管理 =====

interface WorkspaceConfig {
  permissionMode?: PromaPermissionMode
  attachedDirectories?: string[]
}

function getWorkspaceConfigPath(workspaceSlug: string): string {
  return join(getAgentWorkspacePath(workspaceSlug), 'config.json')
}

function readWorkspaceConfig(workspaceSlug: string): WorkspaceConfig {
  const configPath = getWorkspaceConfigPath(workspaceSlug)

  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as WorkspaceConfig
  } catch {
    return {}
  }
}

function writeWorkspaceConfig(workspaceSlug: string, config: WorkspaceConfig): void {
  const configPath = getWorkspaceConfigPath(workspaceSlug)
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/** 获取工作区权限模式，默认 'acceptEdits'，支持旧值自动迁移 */
export function getWorkspacePermissionMode(workspaceSlug: string): PromaPermissionMode {
  const config = readWorkspaceConfig(workspaceSlug)
  return config.permissionMode ? migratePermissionMode(config.permissionMode) : 'acceptEdits'
}

export function setWorkspacePermissionMode(workspaceSlug: string, mode: PromaPermissionMode): void {
  const config = readWorkspaceConfig(workspaceSlug)
  const updated: WorkspaceConfig = { ...config, permissionMode: mode }
  writeWorkspaceConfig(workspaceSlug, updated)
  console.log(`[Agent 工作区] 权限模式已更新: ${workspaceSlug} → ${mode}`)
}

// ===== 工作区级附加目录管理 =====

export function getWorkspaceAttachedDirectories(workspaceSlug: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  return config.attachedDirectories ?? []
}

export function attachWorkspaceDirectory(workspaceSlug: string, directoryPath: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  const existing = config.attachedDirectories ?? []

  if (existing.includes(directoryPath)) {
    return existing
  }

  const updated = [...existing, directoryPath]
  writeWorkspaceConfig(workspaceSlug, { ...config, attachedDirectories: updated })
  console.log(`[Agent 工作区] 已附加工作区目录: ${directoryPath} → ${workspaceSlug}`)
  return updated
}

export function detachWorkspaceDirectory(workspaceSlug: string, directoryPath: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  const existing = config.attachedDirectories ?? []
  const updated = existing.filter((d) => d !== directoryPath)
  writeWorkspaceConfig(workspaceSlug, { ...config, attachedDirectories: updated })
  console.log(`[Agent 工作区] 已移除工作区目录: ${directoryPath} ← ${workspaceSlug}`)
  return updated
}
