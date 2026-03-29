/**
 * Agent 工作区管理器
 *
 * 负责 Agent 工作区的 CRUD 操作。
 * - 工作区索引：~/.proma/agent-workspaces.json（轻量元数据）
 * - 工作区目录：~/.proma/agent-workspaces/{slug}/（Agent 的 cwd）
 *
 * 照搬 agent-session-manager.ts 的 readIndex/writeIndex 模式。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, cpSync, rmSync, mkdirSync, statSync, renameSync } from 'node:fs'
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
import type { AgentWorkspace, McpServerEntry, WorkspaceMcpConfig, SkillMeta, WorkspaceCapabilities, PromaPermissionMode } from '@proma/shared'
import { migratePermissionMode } from '@proma/shared'

/**
 * 工作区索引文件格式
 */
interface AgentWorkspacesIndex {
  /** 配置版本号 */
  version: number
  /** 工作区元数据列表 */
  workspaces: AgentWorkspace[]
}

/** 当前索引版本 */
const INDEX_VERSION = 2

/**
 * 读取工作区索引文件
 *
 * 读取后自动执行版本迁移。
 */
function readIndex(): AgentWorkspacesIndex {
  const indexPath = getAgentWorkspacesIndexPath()

  if (!existsSync(indexPath)) {
    return { version: INDEX_VERSION, workspaces: [] }
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8')
    const index = JSON.parse(raw) as AgentWorkspacesIndex

    // 版本迁移
    if ((index.version ?? 1) < INDEX_VERSION) {
      migrateIndex(index)
    }

    return index
  } catch (error) {
    console.error('[Agent 工作区] 读取索引文件失败:', error)
    return { version: INDEX_VERSION, workspaces: [] }
  }
}

/**
 * 索引版本迁移
 *
 * 按版本号逐级执行迁移逻辑，最终写回文件。
 */
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

/**
 * 一次性迁移：为所有工作区启用 skill-creator
 *
 * 将 skills-inactive/skill-creator 移动到 skills/skill-creator。
 * 若 skill-creator 不存在于任何位置则跳过（用户可能已删除）。
 */
function activateSkillCreatorInAllWorkspaces(index: AgentWorkspacesIndex): void {
  for (const workspace of index.workspaces) {
    const activeDir = getWorkspaceSkillsDir(workspace.slug)
    const inactiveDir = getInactiveSkillsDir(workspace.slug)

    const inactivePath = join(inactiveDir, 'skill-creator')
    const activePath = join(activeDir, 'skill-creator')

    // 已在 skills/ 中或两处都不存在 → 跳过
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

/**
 * 写入工作区索引文件
 */
function writeIndex(index: AgentWorkspacesIndex): void {
  const indexPath = getAgentWorkspacesIndexPath()

  try {
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Agent 工作区] 写入索引文件失败:', error)
    throw new Error('写入 Agent 工作区索引失败')
  }
}

/**
 * 将名称转换为 URL-safe 的 slug
 *
 * 英文：kebab-case，中文/特殊字符：fallback 为 workspace-{timestamp}
 */
function slugify(name: string, existingSlugs: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // 中文或其他非 ASCII 名称 fallback
  if (!base) {
    base = `workspace-${Date.now()}`
  }

  // 重复时加数字后缀
  let slug = base
  let counter = 1
  while (existingSlugs.has(slug)) {
    slug = `${base}-${counter}`
    counter++
  }

  return slug
}

/**
 * 获取所有工作区（按 updatedAt 降序）
 */
export function listAgentWorkspaces(): AgentWorkspace[] {
  const index = readIndex()
  return index.workspaces.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 按 ID 获取单个工作区
 */
export function getAgentWorkspace(id: string): AgentWorkspace | undefined {
  const index = readIndex()
  return index.workspaces.find((w) => w.id === id)
}

/**
 * 将默认 Skills 模板复制到工作区 skills/ 目录
 *
 * 从 ~/.proma/default-skills/ 复制所有内容。
 * 如果模板目录不存在或为空则跳过。
 */
function copyDefaultSkills(workspaceSlug: string): void {
  const defaultDir = getDefaultSkillsDir()
  const targetDir = getWorkspaceSkillsDir(workspaceSlug)

  try {
    const entries = readdirSync(defaultDir, { withFileTypes: true })
    if (entries.length === 0) return

    cpSync(defaultDir, targetDir, { recursive: true })
    console.log(`[Agent 工作区] 已复制默认 Skills 到: ${workspaceSlug}`)
  } catch {
    // 模板目录不存在或复制失败，跳过不影响工作区创建
  }
}

/**
 * 创建新工作区
 */
export function createAgentWorkspace(name: string): AgentWorkspace {
  const index = readIndex()
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

  // 创建工作区目录
  getAgentWorkspacePath(slug)

  // 创建 SDK plugin manifest（SDK 需要此文件发现 skills）
  ensurePluginManifest(slug, name)

  // 复制默认 Skills 模板
  copyDefaultSkills(slug)

  index.workspaces.push(workspace)
  writeIndex(index)

  console.log(`[Agent 工作区] 已创建工作区: ${name} (slug: ${slug})`)
  return workspace
}

/**
 * 更新工作区（仅更新名称，不改 slug/目录）
 */
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

/**
 * 删除工作区（仅删索引条目，保留目录避免误删用户文件）
 */
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

/**
 * 确保默认工作区存在
 *
 * 首次启动时自动创建名为"默认工作区"的工作区（slug: default）。
 * 返回默认工作区的 ID。
 */
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

    // 创建工作区目录
    getAgentWorkspacePath('default')

    // 创建 SDK plugin manifest
    ensurePluginManifest('default', '默认工作区')

    // 复制默认 Skills 模板
    copyDefaultSkills('default')

    index.workspaces.push(defaultWs)
    writeIndex(index)

    console.log('[Agent 工作区] 已创建默认工作区')
  } else {
    // 迁移兼容：确保已有默认工作区包含 plugin manifest 和 skills
    ensurePluginManifest(defaultWs.slug, defaultWs.name)
  }

  return defaultWs
}

// ===== 默认 Skills 自动升级 =====

/**
 * 升级所有工作区中的默认 Skills
 *
 * 遍历所有工作区，将版本过旧的默认 Skill 更新到 ~/.proma/default-skills/ 中的最新版本。
 * 仅更新 slug 与默认 Skill 匹配的目录，跳过用户自建的 Skill。
 * 同时处理 skills/（活跃）和 skills-inactive/（已禁用）目录。
 */
export function upgradeDefaultSkillsInWorkspaces(): void {
  const defaultDir = getDefaultSkillsDir()

  // 收集默认 Skills 的 slug → version 映射
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
    return // default-skills 目录不存在，跳过
  }

  if (defaultSkills.size === 0) return

  // 遍历所有工作区
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

/**
 * 比较两个 semver 版本字符串
 */
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

/**
 * 确保工作区包含 .claude-plugin/plugin.json 清单
 *
 * SDK 需要此文件才能将工作区识别为合法插件，
 * 进而发现 skills/ 目录下的 Skill。
 */
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

/**
 * 读取工作区 MCP 配置
 */
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

/**
 * 保存工作区 MCP 配置
 */
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

/**
 * 扫描工作区 Skills 目录
 *
 * 遍历 skills/{slug}/SKILL.md，解析 YAML frontmatter 提取元数据。
 */
/**
 * 扫描工作区活跃 Skills 目录
 *
 * 仅返回 skills/ 下的活跃 Skill，供 prompt builder 和 capabilities 使用。
 */
export function getWorkspaceSkills(workspaceSlug: string): SkillMeta[] {
  return scanSkillsInDir(getWorkspaceSkillsDir(workspaceSlug), true)
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseSkillFrontmatter(content: string, slug: string, enabled: boolean): SkillMeta {
  const meta: SkillMeta = { slug, name: slug, enabled }

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch) return meta

  const yaml = fmMatch[1]
  if (!yaml) return meta

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')

    if (key === 'name' && value) meta.name = value
    if (key === 'description' && value) meta.description = value
    if (key === 'icon' && value) meta.icon = value
    if (key === 'version' && value) meta.version = value
  }

  return meta
}

// ===== 工作区能力摘要 =====

/**
 * 获取工作区能力摘要（MCP + Skill 计数）
 */
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

/**
 * 删除工作区 Skill
 *
 * 删除 skills/{slug}/ 整个目录。
 */
export function deleteWorkspaceSkill(workspaceSlug: string, skillSlug: string): void {
  const skillsDir = getWorkspaceSkillsDir(workspaceSlug)
  const skillPath = join(skillsDir, skillSlug)

  if (!existsSync(skillPath)) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  rmSync(skillPath, { recursive: true, force: true })
  console.log(`[Agent 工作区] 已删除 Skill: ${workspaceSlug}/${skillSlug}`)
}

/**
 * 扫描指定目录下的 Skills
 *
 * 通用扫描逻辑，供 getWorkspaceSkills 和 getAllWorkspaceSkills 复用。
 */
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

/**
 * 获取工作区所有 Skills（含活跃和不活跃）
 *
 * 同时扫描 skills/ 和 skills-inactive/ 目录，返回带 enabled 标记的完整列表。
 * 用于设置页 UI 展示。
 */
export function getAllWorkspaceSkills(workspaceSlug: string): SkillMeta[] {
  const activeSkills = scanSkillsInDir(getWorkspaceSkillsDir(workspaceSlug), true)
  const inactiveSkills = scanSkillsInDir(getInactiveSkillsDir(workspaceSlug), false)
  return [...activeSkills, ...inactiveSkills]
}

/**
 * 切换工作区 Skill 的启用/禁用状态
 *
 * 在 skills/ 和 skills-inactive/ 之间移动文件夹。
 */
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

// ===== 权限模式管理 =====

/** 工作区配置文件格式 */
interface WorkspaceConfig {
  permissionMode?: PromaPermissionMode
  attachedDirectories?: string[]
}

/**
 * 获取工作区配置文件路径
 */
function getWorkspaceConfigPath(workspaceSlug: string): string {
  return join(getAgentWorkspacePath(workspaceSlug), 'config.json')
}

/**
 * 读取工作区配置
 */
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

/**
 * 写入工作区配置
 */
function writeWorkspaceConfig(workspaceSlug: string, config: WorkspaceConfig): void {
  const configPath = getWorkspaceConfigPath(workspaceSlug)
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * 获取工作区权限模式
 *
 * 默认返回 'acceptEdits'。支持旧模式值自动迁移。
 */
export function getWorkspacePermissionMode(workspaceSlug: string): PromaPermissionMode {
  const config = readWorkspaceConfig(workspaceSlug)
  return config.permissionMode ? migratePermissionMode(config.permissionMode) : 'acceptEdits'
}

/**
 * 设置工作区权限模式
 */
export function setWorkspacePermissionMode(workspaceSlug: string, mode: PromaPermissionMode): void {
  const config = readWorkspaceConfig(workspaceSlug)
  const updated: WorkspaceConfig = { ...config, permissionMode: mode }
  writeWorkspaceConfig(workspaceSlug, updated)
  console.log(`[Agent 工作区] 权限模式已更新: ${workspaceSlug} → ${mode}`)
}

// ===== 工作区级附加目录管理 =====

/**
 * 获取工作区附加目录列表
 */
export function getWorkspaceAttachedDirectories(workspaceSlug: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  return config.attachedDirectories ?? []
}

/**
 * 附加目录到工作区（所有会话可访问）
 */
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

/**
 * 从工作区移除附加目录
 */
export function detachWorkspaceDirectory(workspaceSlug: string, directoryPath: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  const existing = config.attachedDirectories ?? []
  const updated = existing.filter((d) => d !== directoryPath)
  writeWorkspaceConfig(workspaceSlug, { ...config, attachedDirectories: updated })
  console.log(`[Agent 工作区] 已移除工作区目录: ${directoryPath} ← ${workspaceSlug}`)
  return updated
}
