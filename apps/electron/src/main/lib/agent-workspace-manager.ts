/**
 * Agent 工作区管理器
 *
 * 负责 Agent 工作区的 CRUD 操作。
 * - 工作区索引：~/.proma/agent-workspaces.json（轻量元数据）
 * - 工作区目录：~/.proma/agent-workspaces/{slug}/（Agent 的 cwd）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, cpSync, rmSync, mkdirSync, statSync, renameSync, openSync, readSync, closeSync } from 'node:fs'
import { writeJsonFileAtomic, readJsonFileSafe } from './safe-file'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path'
import {
  getAgentWorkspacesIndexPath,
  getAgentWorkspacesDir,
  getAgentWorkspacePath,
  getWorkspaceMcpPath,
  getWorkspaceSkillsDir,
  getInactiveSkillsDir,
  getDefaultSkillsDir,
  parseSkillVersion,
  getWorkspaceFlowsDir,
  getInactiveFlowsDir,
  getDefaultFlowsDir,
  parseFlowVersion,
  extractMetaBodyFromFlowJs,
  compareSemver,
  getConfigDirName,
} from './config-paths'
import { findAllGitRoots, normalizeGitRoot } from './git-diff-service'
import type { AgentWorkspace, WorkspaceMcpConfig, SkillMeta, SkillImportSource, OtherWorkspaceSkillsGroup, WorkspaceCapabilities, SkillFileNode, SkillFileContent, FlowMeta, FlowImportSource, OtherWorkspaceFlowsGroup } from '@proma/shared'

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

/** 将 ~/.proma/default-skills/ 的内容逐个复制到工作区 skills/ 目录 */
function copyDefaultSkills(workspaceSlug: string): void {
  const defaultDir = getDefaultSkillsDir()
  const targetDir = getWorkspaceSkillsDir(workspaceSlug)

  try {
    const entries = readdirSync(defaultDir, { withFileTypes: true })
    if (entries.length === 0) {
      console.warn(`[Agent 工作区] 默认 Skills 模板为空，工作区 Skills 未初始化: ${workspaceSlug}`)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const source = join(defaultDir, entry.name)
      const target = join(targetDir, entry.name)
      cpSync(source, target, { recursive: true })
    }
    console.log(`[Agent 工作区] 已复制默认 Skills 到: ${workspaceSlug}`)
  } catch (err) {
    console.error(`[Agent 工作区] 复制默认 Skills 失败 (${workspaceSlug}):`, err)
  }
}

/** 将 ~/.proma/default-flows/ 的内容逐个复制到工作区 flows/ 目录 */
function copyDefaultFlows(workspaceSlug: string): void {
  const defaultDir = getDefaultFlowsDir()
  const targetDir = getWorkspaceFlowsDir(workspaceSlug)

  try {
    const entries = readdirSync(defaultDir, { withFileTypes: true })
    if (entries.length === 0) {
      console.warn(`[Agent 工作区] 默认 Flows 模板为空，工作区 Flows 未初始化: ${workspaceSlug}`)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const source = join(defaultDir, entry.name)
      const target = join(targetDir, entry.name)
      if (!existsSync(target)) {
        cpSync(source, target, { recursive: true, filter: skillCopyFilter })
      }
    }
    console.log(`[Agent 工作区] 已复制默认 Flows 到: ${workspaceSlug}`)
  } catch (err) {
    console.error(`[Agent 工作区] 复制默认 Flows 失败 (${workspaceSlug}):`, err)
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
  copyDefaultFlows(slug)

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

/** 删除工作区索引条目及其本地目录 */
export function deleteAgentWorkspace(id: string): void {
  const index = readIndex()
  const idx = index.workspaces.findIndex((w) => w.id === id)

  if (idx === -1) {
    throw new Error(`Agent 工作区不存在: ${id}`)
  }

  const target = index.workspaces[idx]!
  if (target.slug === 'default') {
    throw new Error('默认项目不能删除')
  }
  if (index.workspaces.length <= 1) {
    throw new Error('至少需要保留一个项目')
  }

  const workspacesRoot = resolve(getAgentWorkspacesDir())
  const workspaceDir = resolve(join(workspacesRoot, target.slug))
  const relativePath = relative(workspacesRoot, workspaceDir)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`工作区目录路径异常，已跳过删除: ${workspaceDir}`)
  }

  // 先移除索引条目并落盘，再删目录：
  // 即使随后 rmSync 失败，也只会残留一个无引用目录（无害，可被同 slug 重建覆盖），
  // 而不会留下指向已删目录的孤儿索引条目导致 UI 状态不一致
  const removed = index.workspaces.splice(idx, 1)[0]!
  writeIndex(index)

  if (existsSync(workspaceDir)) {
    try {
      rmSync(workspaceDir, { recursive: true, force: true })
      console.log(`[Agent 工作区] 已删除工作区目录: ${workspaceDir}`)
    } catch (error) {
      console.warn(`[Agent 工作区] 删除工作区目录失败，已残留无引用目录 (${target.slug}):`, error)
    }
  }

  console.log(`[Agent 工作区] 已删除工作区: ${removed.name} (slug: ${removed.slug})`)
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
    copyDefaultFlows('default')

    index.workspaces.push(defaultWs)
    writeIndex(index)

    console.log('[Agent 工作区] 已创建默认工作区')
  } else {
    // 迁移兼容：确保已有默认工作区包含 plugin manifest
    ensurePluginManifest(defaultWs.slug, defaultWs.name)
  }

  return defaultWs
}

// ===== 通用 slug 校验 =====

const MAX_SLUG_LENGTH = 64
const SLUG_VALID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** 校验 workspace/skill/flow slug 合法性，阻止路径遍历 */
export function validateSlug(slug: string, label: string = 'slug'): void {
  if (!slug || typeof slug !== 'string') {
    throw new Error(`${label} 不能为空`)
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`${label} 过长（最大 ${MAX_SLUG_LENGTH} 字符）`)
  }
  if (!SLUG_VALID_PATTERN.test(slug)) {
    throw new Error(`${label} 包含非法字符，只允许字母、数字、下划线、连字符，且不能以连字符开头`)
  }
}

// ===== 默认 Skills 自动升级 =====

/**
 * 同步默认 Skills 到所有工作区。规则：
 * - 缺失：注入到 skills/（active），让升级后新增的内置 Skill 对老用户立即可用
 * - 已存在（active 或 inactive）：比较 SKILL.md 的 version，bundled 更新时才覆盖
 *   （保留用户停用决定 — 在 inactive 的依然在 inactive；同时避免每次启动
 *    全量 cpSync 4MB+ 文件阻塞主进程）
 */
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
      defaultSkills.set(entry.name, {
        version: parseSkillVersion(sourcePath),
        sourcePath,
      })
    }
  } catch {
    return
  }

  if (defaultSkills.size === 0) return

  const index = readIndex()

  for (const workspace of index.workspaces) {
    const activeDir = getWorkspaceSkillsDir(workspace.slug)
    const inactiveDir = getInactiveSkillsDir(workspace.slug)

    for (const [slug, info] of defaultSkills) {
      const activePath = join(activeDir, slug)
      const inactivePath = join(inactiveDir, slug)

      if (existsSync(activePath)) {
        const currentVer = parseSkillVersion(activePath)
        if (compareSemver(info.version, currentVer) > 0) {
          if (safeReplaceSkillDir(info.sourcePath, activePath)) {
            console.log(
              `[Agent 工作区] 已升级默认 Skill: ${workspace.slug}/${slug} (active, ${currentVer} → ${info.version})`,
            )
          } else {
            console.warn(
              `[Agent 工作区] 升级默认 Skill 失败 (${workspace.slug}/${slug}, active)，跳过`,
            )
          }
        }
        continue
      }

      if (existsSync(inactivePath)) {
        const currentVer = parseSkillVersion(inactivePath)
        if (compareSemver(info.version, currentVer) > 0) {
          if (safeReplaceSkillDir(info.sourcePath, inactivePath)) {
            console.log(
              `[Agent 工作区] 已升级默认 Skill: ${workspace.slug}/${slug} (inactive, ${currentVer} → ${info.version})`,
            )
          } else {
            console.warn(
              `[Agent 工作区] 升级默认 Skill 失败 (${workspace.slug}/${slug}, inactive)，跳过`,
            )
          }
        }
        continue
      }

      try {
        if (!existsSync(activeDir)) mkdirSync(activeDir, { recursive: true })
        cpSync(info.sourcePath, activePath, { recursive: true, filter: skillCopyFilter })
        console.log(`[Agent 工作区] 已注入新默认 Skill: ${workspace.slug}/${slug} → active`)
      } catch (err) {
        console.warn(`[Agent 工作区] 注入默认 Skill 失败 (${workspace.slug}/${slug}):`, err)
      }
    }
  }
}

// ===== 默认 Flows 自动升级 =====

/**
 * 同步默认 Flows 到所有工作区。规则：
 * - 缺失：注入到 flows/（active），让升级后新增的内置 Flow 对老用户立即可用
 * - 已存在（active 或 inactive）：比较 flow.js 的 version，bundled 更新时才覆盖
 */
export function upgradeDefaultFlowsInWorkspaces(): void {
  const defaultDir = getDefaultFlowsDir()

  interface DefaultFlowInfo {
    version: string
    sourcePath: string
  }
  const defaultFlows = new Map<string, DefaultFlowInfo>()

  try {
    const entries = readdirSync(defaultDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sourcePath = join(defaultDir, entry.name)
      defaultFlows.set(entry.name, {
        version: parseFlowVersion(sourcePath),
        sourcePath,
      })
    }
  } catch {
    return
  }

  if (defaultFlows.size === 0) return

  const index = readIndex()

  for (const workspace of index.workspaces) {
    const activeDir = getWorkspaceFlowsDir(workspace.slug)
    const inactiveDir = getInactiveFlowsDir(workspace.slug)

    for (const [slug, info] of defaultFlows) {
      const activePath = join(activeDir, slug)
      const inactivePath = join(inactiveDir, slug)

      if (existsSync(activePath)) {
        const currentVer = parseFlowVersion(activePath)
        if (compareSemver(info.version, currentVer) > 0) {
          if (safeReplaceFlowDir(info.sourcePath, activePath)) {
            console.log(
              `[Agent 工作区] 已升级默认 Flow: ${workspace.slug}/${slug} (active, ${currentVer} → ${info.version})`,
            )
          } else {
            console.warn(
              `[Agent 工作区] 升级默认 Flow 失败 (${workspace.slug}/${slug}, active)，跳过`,
            )
          }
        }
        continue
      }

      if (existsSync(inactivePath)) {
        const currentVer = parseFlowVersion(inactivePath)
        if (compareSemver(info.version, currentVer) > 0) {
          if (safeReplaceFlowDir(info.sourcePath, inactivePath)) {
            console.log(
              `[Agent 工作区] 已升级默认 Flow: ${workspace.slug}/${slug} (inactive, ${currentVer} → ${info.version})`,
            )
          } else {
            console.warn(
              `[Agent 工作区] 升级默认 Flow 失败 (${workspace.slug}/${slug}, inactive)，跳过`,
            )
          }
        }
        continue
      }

      try {
        if (!existsSync(activeDir)) mkdirSync(activeDir, { recursive: true })
        cpSync(info.sourcePath, activePath, { recursive: true, filter: skillCopyFilter })
        console.log(`[Agent 工作区] 已注入新默认 Flow: ${workspace.slug}/${slug} → active`)
      } catch (err) {
        console.warn(`[Agent 工作区] 注入默认 Flow 失败 (${workspace.slug}/${slug}):`, err)
      }
    }
  }
}

/** 安全替换一个 flow 目录：原子替换 + 失败恢复 */
function safeReplaceFlowDir(sourcePath: string, targetPath: string): boolean {
  try {
    // 原子替换：先复制到临时目录，成功后用 rename 替换目标
    const parentDir = dirname(targetPath)
    const base = basename(targetPath)
    const uniqueId = randomUUID().slice(0, 8)
    const tempDir = join(parentDir, `.tmp-${base}-${uniqueId}`)
    const backupDir = join(parentDir, `.backup-${base}-${uniqueId}`)

    cpSync(sourcePath, tempDir, { recursive: true })
    renameSync(targetPath, backupDir)

    try {
      renameSync(tempDir, targetPath)
    } catch (renameErr) {
      // 步骤3失败：尝试恢复 backup 到原位置
      try { renameSync(backupDir, targetPath) } catch { /* 忽略恢复失败 */ }
      throw renameErr
    }

    // 成功后清理 backup
    try { rmSync(backupDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    return true
  } catch (err) {
    console.warn(`[Agent 工作区] safeReplaceFlowDir 失败 (${targetPath}):`, err)
    return false
  }
}

/**
 * 安全替换一个 skill 目录：先 rmSync 再 cpSync，每步独立 try/catch。
 *
 * 直接 cpSync({ force: true }) 在目标存在只读文件（如 .git/objects/ 下的 0444
 * 文件）时会因 EACCES 失败；rmSync({ force: true }) 不依赖目标文件的写权限，
 * 仅需父目录可写即可 unlink。这种"先删后拷"也修正了 cpSync 的合并语义——
 * bundle 已删除的文件能从用户目录中真正消失。
 *
 * @returns 成功返回 true；任何步骤失败返回 false（已记录日志，不抛出）
 */
function safeReplaceSkillDir(sourcePath: string, targetPath: string): boolean {
  try {
    rmSync(targetPath, { recursive: true, force: true })
    cpSync(sourcePath, targetPath, { recursive: true, filter: skillCopyFilter })
    return true
  } catch (err) {
    console.warn(`[Agent 工作区] safeReplaceSkillDir 失败 (${targetPath}):`, err)
    return false
  }
}

/** 防御性目录基名集合：复制 skill 时永远跳过这些目录，避免 .git 0444 文件、
 *  node_modules 文件爆炸等场景把启动期同步链路炸掉。 */
const SKILL_COPY_BLOCKLIST = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  '.next',
  '.cache',
  '.turbo',
  '__pycache__',
])

export function skillCopyFilter(src: string): boolean {
  return !SKILL_COPY_BLOCKLIST.has(basename(src))
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

  const validKeys = new Set(['name', 'description', 'group', 'icon', 'version'])
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
  if (entries.group) meta.group = entries.group.trim()
  if (entries.icon) meta.icon = entries.icon.trim()
  if (entries.version) meta.version = entries.version.trim()

  return meta
}

// ===== Flow 管理 =====

/**
 * 获取工作区 Flow 列表
 *
 * 扫描活跃（flows/）和禁用（flows-inactive/）目录，解析 flow.js 的 meta 信息。
 */
export function getWorkspaceFlows(workspaceSlug: string): FlowMeta[] {
  const activeDir = getWorkspaceFlowsDir(workspaceSlug)
  const inactiveDir = getInactiveFlowsDir(workspaceSlug)
  const flows: FlowMeta[] = []

  // 扫描活跃目录
  try {
    const entries = readdirSync(activeDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // 跳过临时/备份目录和隐藏目录，避免 safeReplaceFlowDir 残留变成幻影 Flow
      if (entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue
      const flowJsPath = join(activeDir, entry.name, 'flow.js')
      if (!existsSync(flowJsPath)) continue

      const meta = parseFlowJsMeta(flowJsPath, entry.name, true)
      if (meta) flows.push(meta)
    }
  } catch {
    // 目录不存在或读取失败
  }

  // 扫描禁用目录
  try {
    const entries = readdirSync(inactiveDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // 跳过临时/备份目录和隐藏目录
      if (entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue
      const flowJsPath = join(inactiveDir, entry.name, 'flow.js')
      if (!existsSync(flowJsPath)) continue

      const meta = parseFlowJsMeta(flowJsPath, entry.name, false)
      if (meta) flows.push(meta)
    }
  } catch {
    // 目录不存在或读取失败
  }

  return flows
}

/**
 * 从 flow.js 解析 FlowMeta
 *
 * 使用正则+括号匹配解析 export const meta = { ... }，
 * 与 parseSkillFrontmatter 风格一致。
 * meta 必须是纯字面量（SDK 要求），不含函数调用或变量引用。
 */
function parseFlowJsMeta(
  flowJsPath: string,
  slug: string,
  enabled: boolean,
): FlowMeta | null {
  try {
    const content = readFileSync(flowJsPath, 'utf-8')

    // 使用共享函数提取 meta 对象体（自动跳过字符串和注释中的花括号）
    const metaBody = extractMetaBodyFromFlowJs(content)
    if (!metaBody) return null

    // 简单行级解析
    let name = `!${slug}`
    let description: string | undefined
    let group: string | undefined
    let icon: string | undefined
    let version: string | undefined
    let type: 'builtin' | 'custom' = 'custom'
    let argsHint: string | undefined

    for (const line of metaBody.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim().replace(/[,，]$/, '').replace(/^["']|["']$/g, '')

      switch (key) {
        case 'name': name = value || name; break
        case 'description': description = value || undefined; break
        case 'group': group = value || undefined; break
        case 'icon': icon = value || undefined; break
        case 'version': version = value || undefined; break
        case 'type': if (value === 'builtin' || value === 'custom') type = value; break
        case 'argsHint': argsHint = value || undefined; break
      }
    }

    // 读取导入来源元数据
    const flowDir = dirname(flowJsPath)
    let importSource: FlowImportSource | undefined
    try {
      const sourcePath = join(flowDir, SOURCE_META_FILE)
      if (existsSync(sourcePath)) {
        const parsed = JSON.parse(readFileSync(sourcePath, 'utf-8')) as Partial<FlowImportSource>
        // 基本字段校验：缺少 sourceWorkspaceSlug 视为无效
        if (parsed?.sourceWorkspaceSlug) {
          importSource = parsed as FlowImportSource
        }
      }
    } catch {
      // 解析失败，忽略
    }

    // 检查是否有更新版本
    let hasUpdate: boolean | undefined
    if (type === 'builtin') {
      // 内置 Flow：与默认源版本对比
      try {
        const defaultDir = getDefaultFlowsDir()
        const defaultFlowPath = join(defaultDir, slug)
        if (existsSync(defaultFlowPath)) {
          const defaultVer = parseFlowVersion(defaultFlowPath)
          if (defaultVer && version && compareSemver(defaultVer, version) > 0) {
            hasUpdate = true
          }
        }
      } catch {
        // 版本对比失败，忽略
      }
    } else if (importSource) {
      // 跨工作区导入的 Flow：与源工作区版本对比
      try {
        const sourceActiveDir = getWorkspaceFlowsDir(importSource.sourceWorkspaceSlug)
        const sourceInactiveDir = getInactiveFlowsDir(importSource.sourceWorkspaceSlug)
        const sourceActiveFlow = join(sourceActiveDir, slug)
        const sourceInactiveFlow = join(sourceInactiveDir, slug)
        const sourceFlowDir = existsSync(sourceActiveFlow) ? sourceActiveFlow
          : existsSync(sourceInactiveFlow) ? sourceInactiveFlow : null
        if (sourceFlowDir) {
          const sourceVer = parseFlowVersion(sourceFlowDir)
          if (sourceVer && compareSemver(sourceVer, importSource.sourceVersion) > 0) {
            hasUpdate = true
          }
        }
      } catch {
        // 版本对比失败，忽略
      }
    }

    return {
      slug,
      name,
      description,
      group,
      icon,
      version,
      enabled,
      type,
      importSource,
      hasUpdate,
      argsHint,
    }
  } catch {
    return null
  }
}

/** 删除工作区 Flow */
export function deleteWorkspaceFlow(workspaceSlug: string, flowSlug: string): void {
  validateSlug(flowSlug, 'Flow slug')
  const activeDir = getWorkspaceFlowsDir(workspaceSlug)
  const inactiveDir = getInactiveFlowsDir(workspaceSlug)
  const activePath = join(activeDir, flowSlug)
  const inactivePath = join(inactiveDir, flowSlug)

  if (existsSync(activePath)) {
    rmSync(activePath, { recursive: true, force: true })
    console.log(`[Agent 工作区] 已删除 Flow: ${workspaceSlug}/${flowSlug} (active)`)
  } else if (existsSync(inactivePath)) {
    rmSync(inactivePath, { recursive: true, force: true })
    console.log(`[Agent 工作区] 已删除 Flow: ${workspaceSlug}/${flowSlug} (inactive)`)
  } else {
    throw new Error(`Flow 不存在: ${flowSlug}`)
  }
}

/** 切换工作区 Flow 启用/禁用 */
export function toggleWorkspaceFlow(workspaceSlug: string, flowSlug: string): boolean {
  validateSlug(flowSlug, 'Flow slug')
  const activeDir = getWorkspaceFlowsDir(workspaceSlug)
  const inactiveDir = getInactiveFlowsDir(workspaceSlug)
  const activePath = join(activeDir, flowSlug)
  const inactivePath = join(inactiveDir, flowSlug)

  // 检查目标位置是否已存在同名目录
  if (existsSync(activePath)) {
    // 活跃 → 禁用：检查禁用目录是否已有同名
    if (existsSync(inactivePath)) {
      throw new Error(`目标目录已存在同名 Flow: ${flowSlug}`)
    }
    renameSync(activePath, inactivePath)
    console.log(`[Agent 工作区] 已禁用 Flow: ${workspaceSlug}/${flowSlug}`)
    return false
  } else if (existsSync(inactivePath)) {
    // 禁用 → 活跃：检查活跃目录是否已有同名
    if (existsSync(activePath)) {
      throw new Error(`目标目录已存在同名 Flow: ${flowSlug}`)
    }
    renameSync(inactivePath, activePath)
    console.log(`[Agent 工作区] 已启用 Flow: ${workspaceSlug}/${flowSlug}`)
    return true
  } else {
    throw new Error(`Flow 不存在: ${flowSlug}`)
  }
}

/** 获取其他工作区的 Flow 列表（导入对话框用） */
export function getOtherWorkspaceFlows(
  currentWorkspaceSlug: string,
): OtherWorkspaceFlowsGroup[] {
  const index = readIndex()
  const groups: OtherWorkspaceFlowsGroup[] = []

  for (const workspace of index.workspaces) {
    if (workspace.slug === currentWorkspaceSlug) continue

    const flows = getWorkspaceFlows(workspace.slug)
    if (flows.length === 0) continue

    groups.push({
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      flows,
    })
  }

  return groups
}

/** 获取默认 Flow slug 列表 */
export function getDefaultFlowSlugs(): string[] {
  const defaultDir = getDefaultFlowsDir()
  try {
    return readdirSync(defaultDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

/** 从其他工作区导入 Flow */
export function importFlowFromWorkspace(
  targetWorkspaceSlug: string,
  sourceWorkspaceSlug: string,
  flowSlug: string,
): void {
  // slug 路径遍历防护
  validateSlug(targetWorkspaceSlug, '目标工作区 slug')
  validateSlug(sourceWorkspaceSlug, '源工作区 slug')
  validateSlug(flowSlug, 'Flow slug')

  const sourceActiveDir = getWorkspaceFlowsDir(sourceWorkspaceSlug)
  const sourceInactiveDir = getInactiveFlowsDir(sourceWorkspaceSlug)
  const targetActiveDir = getWorkspaceFlowsDir(targetWorkspaceSlug)

  const sourcePath = join(sourceActiveDir, flowSlug)
  const sourceInactivePath = join(sourceInactiveDir, flowSlug)
  const targetPath = join(targetActiveDir, flowSlug)

  // 优先从活跃目录复制
  const src = existsSync(sourcePath) ? sourcePath : existsSync(sourceInactivePath) ? sourceInactivePath : null
  if (!src) {
    throw new Error(`源 Flow 不存在: ${sourceWorkspaceSlug}/${flowSlug}`)
  }

  // 检查目标是否已存在（重名检测）
  if (existsSync(targetPath)) {
    throw new Error(`目标工作区已存在同名 Flow: ${flowSlug}`)
  }

  cpSync(src, targetPath, { recursive: true })

  // 记录导入来源，支持跨工作区 hasUpdate 检测
  const sourceWorkspace = readIndex().workspaces.find(w => w.slug === sourceWorkspaceSlug)
  const sourceVersion = parseFlowVersion(src) || '0.0.0'
  const importSource: FlowImportSource = {
    sourceWorkspaceSlug,
    sourceWorkspaceName: sourceWorkspace?.name || sourceWorkspaceSlug,
    importedAt: new Date().toISOString(),
    sourceVersion,
  }
  writeFileSync(join(targetPath, SOURCE_META_FILE), JSON.stringify(importSource, null, 2), 'utf-8')

  console.log(`[Agent 工作区] 已导入 Flow: ${sourceWorkspaceSlug}/${flowSlug} → ${targetWorkspaceSlug}`)
}

/** 从源工作区同步更新已导入的 Flow */
export function updateFlowFromSource(
  targetWorkspaceSlug: string,
  sourceWorkspaceSlug: string,
  flowSlug: string,
): void {
  // slug 路径遍历防护
  validateSlug(targetWorkspaceSlug, '目标工作区 slug')
  validateSlug(sourceWorkspaceSlug, '源工作区 slug')
  validateSlug(flowSlug, 'Flow slug')

  const targetActiveDir = getWorkspaceFlowsDir(targetWorkspaceSlug)
  const targetInactiveDir = getInactiveFlowsDir(targetWorkspaceSlug)
  const targetActivePath = join(targetActiveDir, flowSlug)
  const targetInactivePath = join(targetInactiveDir, flowSlug)
  const existingTarget = existsSync(targetActivePath) ? targetActivePath
    : existsSync(targetInactivePath) ? targetInactivePath : null

  if (!existingTarget) {
    throw new Error(`Flow 不存在: ${flowSlug}`)
  }

  // 验证目标 Flow 是否为跨工作区导入的
  let originalImportSource: FlowImportSource | undefined
  try {
    const sourceMetaPath = join(existingTarget, SOURCE_META_FILE)
    if (existsSync(sourceMetaPath)) {
      originalImportSource = JSON.parse(readFileSync(sourceMetaPath, 'utf-8')) as FlowImportSource
    }
  } catch {
    // 解析失败，忽略
  }
  if (!originalImportSource) {
    throw new Error(`Flow ${flowSlug} 不是从其他工作区导入的，无法从源更新`)
  }

  // 记录原始位置（active 或 inactive）
  const wasActive = existingTarget === targetActivePath

  // 从源工作区复制到临时目录
  const sourceActiveDir = getWorkspaceFlowsDir(sourceWorkspaceSlug)
  const sourceInactiveDir = getInactiveFlowsDir(sourceWorkspaceSlug)
  const sourceActivePath = join(sourceActiveDir, flowSlug)
  const sourceInactivePath = join(sourceInactiveDir, flowSlug)
  const src = existsSync(sourceActivePath) ? sourceActivePath
    : existsSync(sourceInactivePath) ? sourceInactivePath : null
  if (!src) {
    throw new Error(`源 Flow 不存在: ${sourceWorkspaceSlug}/${flowSlug}`)
  }

  // 原子替换：先复制到临时目录，成功后替换
  const tempDir = join(wasActive ? targetActiveDir : targetInactiveDir, `${flowSlug}.tmp`)
  let cleanupNeeded = false
  try {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    cpSync(src, tempDir, { recursive: true })
    cleanupNeeded = true

    // 写入更新后的来源信息
    const sourceWorkspace = readIndex().workspaces.find(w => w.slug === sourceWorkspaceSlug)
    const sourceVersion = parseFlowVersion(src) || '0.0.0'
    const updatedImportSource: FlowImportSource = {
      sourceWorkspaceSlug,
      sourceWorkspaceName: sourceWorkspace?.name || sourceWorkspaceSlug,
      importedAt: originalImportSource.importedAt, // 保留原始导入时间
      sourceVersion,
    }
    writeFileSync(join(tempDir, SOURCE_META_FILE), JSON.stringify(updatedImportSource, null, 2), 'utf-8')

    // 替换旧目录
    rmSync(existingTarget, { recursive: true, force: true })
    renameSync(tempDir, existingTarget)
    cleanupNeeded = false

    console.log(`[Agent 工作区] 已从源更新 Flow: ${sourceWorkspaceSlug}/${flowSlug} → ${targetWorkspaceSlug}`)
  } finally {
    // 确保临时目录被清理（即使部分步骤失败）
    if (cleanupNeeded && existsSync(tempDir)) {
      try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  }
}

/** 从默认源升级内置 Flow 到最新版本 */
export function upgradeDefaultFlowInWorkspace(
  targetWorkspaceSlug: string,
  flowSlug: string,
): boolean {
  validateSlug(flowSlug, 'Flow slug')
  const defaultDir = getDefaultFlowsDir()
  const sourcePath = join(defaultDir, flowSlug)
  if (!existsSync(join(sourcePath, 'flow.js'))) {
    throw new Error(`默认 Flow 不存在: ${flowSlug}`)
  }

  const activeDir = getWorkspaceFlowsDir(targetWorkspaceSlug)
  const inactiveDir = getInactiveFlowsDir(targetWorkspaceSlug)
  const activeTarget = join(activeDir, flowSlug)
  const inactiveTarget = join(inactiveDir, flowSlug)

  // 判断目标位置（活跃或禁用）
  let targetPath: string
  if (existsSync(activeTarget)) {
    targetPath = activeTarget
  } else if (existsSync(inactiveTarget)) {
    targetPath = inactiveTarget
  } else {
    throw new Error(`工作区中不存在 Flow: ${flowSlug}`)
  }

  // 保留导入来源元数据（如果目标已有 .source.json）
  const sourceMetaPath = join(targetPath, SOURCE_META_FILE)
  let preservedSourceMeta: FlowImportSource | undefined
  if (existsSync(sourceMetaPath)) {
    try {
      preservedSourceMeta = JSON.parse(readFileSync(sourceMetaPath, 'utf-8')) as FlowImportSource
    } catch {
      // 解析失败，忽略
    }
  }

  const result = safeReplaceFlowDir(sourcePath, targetPath)

  // 恢复跨工作区导入来源元数据（仅当 Flow 是从其他工作区导入时才恢复，
  // 内置 Flow 升级不应有 .source.json）
  if (preservedSourceMeta && result && preservedSourceMeta.sourceWorkspaceSlug) {
    try {
      writeFileSync(sourceMetaPath, JSON.stringify(preservedSourceMeta, null, 2), 'utf-8')
    } catch (err) {
      console.warn(`[Agent 工作区] 恢复 .source.json 失败 (${targetPath}):`, err)
    }
  }

  return result
}

/** 读取 flow.js 全文内容 */
export function readFlowContent(workspaceSlug: string, flowSlug: string): string {
  validateSlug(flowSlug, 'Flow slug')
  const activeDir = getWorkspaceFlowsDir(workspaceSlug)
  const inactiveDir = getInactiveFlowsDir(workspaceSlug)
  const activePath = join(activeDir, flowSlug, 'flow.js')
  const inactivePath = join(inactiveDir, flowSlug, 'flow.js')

  const path = existsSync(activePath) ? activePath : existsSync(inactivePath) ? inactivePath : null
  if (!path) {
    throw new Error(`Flow 不存在: ${flowSlug}`)
  }

  return readFileSync(path, 'utf-8')
}

/** 写入 flow.js 全文内容（支持新建） */
export function writeFlowContent(workspaceSlug: string, flowSlug: string, content: string): void {
  validateSlug(flowSlug, 'Flow slug')
  // 内容长度限制：防止恶意大文件写入
  const MAX_FLOW_CONTENT_LENGTH = 1024 * 1024 // 1MB
  if (content.length > MAX_FLOW_CONTENT_LENGTH) {
    throw new Error(`Flow 内容过长（最大 1MB）`)
  }
  const activeDir = getWorkspaceFlowsDir(workspaceSlug)
  const inactiveDir = getInactiveFlowsDir(workspaceSlug)
  const activePath = join(activeDir, flowSlug, 'flow.js')
  const inactivePath = join(inactiveDir, flowSlug, 'flow.js')

  // 已存在的 Flow：写入原位置（活跃或禁用目录）
  if (existsSync(activePath)) {
    writeFileSync(activePath, content, 'utf-8')
    console.log(`[Agent 工作区] 已更新 Flow: ${workspaceSlug}/${flowSlug}`)
    return
  }
  if (existsSync(inactivePath)) {
    writeFileSync(inactivePath, content, 'utf-8')
    console.log(`[Agent 工作区] 已更新 Flow: ${workspaceSlug}/${flowSlug} (inactive)`)
    return
  }

  // 新建 Flow：在活跃目录下创建
  const targetDir = join(activeDir, flowSlug)
  mkdirSync(targetDir, { recursive: true })
  const targetPath = join(targetDir, 'flow.js')
  writeFileSync(targetPath, content, 'utf-8')
  console.log(`[Agent 工作区] 已创建 Flow: ${workspaceSlug}/${flowSlug}`)
}

/**
 * 将 SDK workflow 输出脚本保存为 Flow
 *
 * 读取 SDK 持久化的脚本文件，写入到 flows/ 目录下。
 * 如果指定 flowSlug 对应的 Flow 已存在，覆盖其 flow.js；
 * 如果不存在，创建新 Flow 目录。
 */
export function saveWorkflowAsFlow(workspaceSlug: string, scriptPath: string, flowSlug?: string): string {
  // 校验 scriptPath 必须在合法的临时目录下（防止路径遍历读取任意文件）
  const allowedPrefixes = [
    join(homedir(), getConfigDirName(), 'agent-sessions'),
    join(homedir(), getConfigDirName(), 'agent-workspaces'),
  ]
  // Windows 路径不区分大小写，使用 normalize + toLowerCase 比较
  const normalizedScriptPath = resolve(scriptPath).toLowerCase()
  const sep = process.platform === 'win32' ? '\\' : '/'
  if (!allowedPrefixes.some((prefix) => {
    const normalizedPrefix = resolve(prefix).toLowerCase() + sep
    return normalizedScriptPath.startsWith(normalizedPrefix)
  })) {
    throw new Error(`非法脚本路径: ${scriptPath}`)
  }

  // 读取 SDK 持久化的脚本文件
  if (!existsSync(scriptPath)) {
    throw new Error(`脚本文件不存在: ${scriptPath}`)
  }
  const content = readFileSync(scriptPath, 'utf-8')

  // 从脚本 meta 中提取 slug（如果没有传入），并校验合法性
  const slug = flowSlug || extractSlugFromScript(content) || `custom-flow-${Date.now().toString(36)}`
  validateSlug(slug, 'Flow slug')

  // 写入到 flows/ 目录
  const flowsDir = getWorkspaceFlowsDir(workspaceSlug)
  const targetDir = join(flowsDir, slug)
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }
  const targetPath = join(targetDir, 'flow.js')
  writeFileSync(targetPath, content, 'utf-8')

  console.log(`[Agent 工作区] 已保存 Workflow 为 Flow: ${workspaceSlug}/${slug}`)
  return slug
}

/**
 * 从 flow.js 脚本内容中提取 slug
 *
 * 尝试从 meta.name 字段提取（如 "!deep-research" → "deep-research"）。
 */
function extractSlugFromScript(content: string): string | null {
  const match = content.match(/name:\s*['"]!(.+?)['"]/)
  return match?.[1] ?? null
}

// ===== 工作区能力摘要 =====

export function getWorkspaceCapabilities(workspaceSlug: string): WorkspaceCapabilities {
  const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
  const skills = getWorkspaceSkills(workspaceSlug)
  const flows = getWorkspaceFlows(workspaceSlug)

  const mcpServers = Object.entries(mcpConfig.servers ?? {}).map(([name, entry]) => ({
    name,
    enabled: entry.enabled,
    type: entry.type,
  }))

  return { mcpServers, skills, flows }
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

/** 获取默认 Skills 的 slug 列表（来自 ~/.proma/default-skills/） */
export function getDefaultSkillSlugs(): string[] {
  const dir = getDefaultSkillsDir()
  if (!existsSync(dir)) return []

  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
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

export function readWorkspaceSkillContent(workspaceSlug: string, skillSlug: string): string {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  const mdPath = join(dir, 'SKILL.md')
  if (!existsSync(mdPath)) throw new Error(`SKILL.md 不存在: ${mdPath}`)
  return readFileSync(mdPath, 'utf-8')
}

export function writeWorkspaceSkillContent(workspaceSlug: string, skillSlug: string, content: string): void {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
  console.log(`[Agent 工作区] 已更新 SKILL.md: ${workspaceSlug}/${skillSlug}`)
}

// ===== Skill 子文件管理 =====

/** 单个子文件大小上限（10 MB），超过则拒绝读入到编辑器 */
const SKILL_FILE_SIZE_LIMIT = 10 * 1024 * 1024
/** 文件树递归深度上限，防止异常深嵌套 */
const SKILL_TREE_MAX_DEPTH = 8

/** 把相对路径限制在 Skill 根目录内，并拒绝直接覆盖 SKILL.md */
function resolveSkillChildPath(skillDir: string, relativePath: string, opts: { allowSkillMd?: boolean } = {}): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('相对路径不能为空')
  }
  if (isAbsolute(relativePath)) {
    throw new Error('禁止传入绝对路径')
  }
  const normalized = relativePath.replace(/\\/g, '/')
  const resolved = resolve(skillDir, normalized)
  const rel = relative(skillDir, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('非法路径：禁止访问 Skill 目录外')
  }
  // 用 lowercase 比较，避免 macOS/Windows 的大小写不敏感文件系统上 skill.md/Skill.MD 绕过保护
  if (!opts.allowSkillMd && rel.split(/[\\/]/).join('/').toLowerCase() === 'skill.md') {
    throw new Error('SKILL.md 由专用接口管理，请通过 readWorkspaceSkillContent / writeWorkspaceSkillContent')
  }
  return resolved
}

/** 用文件头判断是否为二进制文件（粗略：含 NUL 字节即视为二进制）。只读前 8KB，避免把大文件全量读入内存 */
function isLikelyBinaryFile(absPath: string, size: number): boolean {
  if (size === 0) return false
  let fd: number | undefined
  try {
    fd = openSync(absPath, 'r')
    const buf = Buffer.alloc(Math.min(size, 8192))
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n).includes(0)
  } catch {
    return true
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function buildSkillFileTree(rootDir: string, currentDir: string, depth: number): SkillFileNode[] {
  if (depth > SKILL_TREE_MAX_DEPTH) return []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(currentDir, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: SkillFileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue // 跳过隐藏文件，如 .source.json
    const absPath = join(currentDir, entry.name)
    const rel = relative(rootDir, absPath).split(/[\\/]/).join('/')

    if (rel === 'SKILL.md') continue // SKILL.md 由主编辑器管理

    const isDir = entry.isDirectory()
    if (isDir) {
      nodes.push({
        relativePath: rel,
        name: entry.name,
        type: 'directory',
        children: buildSkillFileTree(rootDir, absPath, depth + 1),
      })
    } else if (entry.isFile()) {
      let size = 0
      try {
        size = statSync(absPath).size
      } catch {
        // ignore
      }
      nodes.push({
        relativePath: rel,
        name: entry.name,
        type: 'file',
        size,
        isText: !isLikelyBinaryFile(absPath, size),
      })
    }
  }

  // 目录优先 + 名称升序
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

export function listSkillFiles(workspaceSlug: string, skillSlug: string): SkillFileNode[] {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  return buildSkillFileTree(dir, dir, 0)
}

export function readSkillFile(workspaceSlug: string, skillSlug: string, relativePath: string): SkillFileContent {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  const abs = resolveSkillChildPath(dir, relativePath)
  if (!existsSync(abs)) throw new Error(`文件不存在: ${relativePath}`)

  const st = statSync(abs)
  if (!st.isFile()) throw new Error(`目标不是文件: ${relativePath}`)
  if (st.size > SKILL_FILE_SIZE_LIMIT) {
    throw new Error(`文件过大（${(st.size / 1024 / 1024).toFixed(2)} MB），超过 10 MB 限制`)
  }

  const binary = isLikelyBinaryFile(abs, st.size)
  return {
    relativePath: relative(dir, abs).split(/[\\/]/).join('/'),
    isText: !binary,
    size: st.size,
    content: binary ? undefined : readFileSync(abs, 'utf-8'),
  }
}

export function writeSkillFile(workspaceSlug: string, skillSlug: string, relativePath: string, content: string): void {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  const abs = resolveSkillChildPath(dir, relativePath)

  const byteLen = Buffer.byteLength(content, 'utf-8')
  if (byteLen > SKILL_FILE_SIZE_LIMIT) {
    throw new Error(`内容过大（${(byteLen / 1024 / 1024).toFixed(2)} MB），超过 10 MB 限制`)
  }

  if (existsSync(abs) && statSync(abs).isDirectory()) {
    throw new Error(`目标是目录，无法写入文件内容: ${relativePath}`)
  }

  // 自动创建父目录
  const parent = dirname(abs)
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true })
  }

  writeFileSync(abs, content, 'utf-8')
  console.log(`[Agent 工作区] 已更新 Skill 子文件: ${workspaceSlug}/${skillSlug}/${relativePath}`)
}

export function createSkillEntry(
  workspaceSlug: string,
  skillSlug: string,
  relativePath: string,
  type: 'file' | 'directory',
): void {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  const abs = resolveSkillChildPath(dir, relativePath)

  if (existsSync(abs)) {
    throw new Error(`目标已存在: ${relativePath}`)
  }

  if (type === 'directory') {
    mkdirSync(abs, { recursive: true })
  } else {
    const parent = dirname(abs)
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
    }
    writeFileSync(abs, '', 'utf-8')
  }
  console.log(`[Agent 工作区] 已创建 Skill 子${type === 'directory' ? '目录' : '文件'}: ${workspaceSlug}/${skillSlug}/${relativePath}`)
}

export function deleteSkillEntry(workspaceSlug: string, skillSlug: string, relativePath: string): void {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  const abs = resolveSkillChildPath(dir, relativePath)
  if (!existsSync(abs)) {
    throw new Error(`目标不存在: ${relativePath}`)
  }
  rmSync(abs, { recursive: true, force: true })
  console.log(`[Agent 工作区] 已删除 Skill 子项: ${workspaceSlug}/${skillSlug}/${relativePath}`)
}

export function renameSkillEntry(
  workspaceSlug: string,
  skillSlug: string,
  fromRelative: string,
  toRelative: string,
): void {
  const dir = resolveSkillDir(workspaceSlug, skillSlug)
  if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
  const fromAbs = resolveSkillChildPath(dir, fromRelative)
  const toAbs = resolveSkillChildPath(dir, toRelative)
  if (!existsSync(fromAbs)) {
    throw new Error(`源不存在: ${fromRelative}`)
  }
  if (existsSync(toAbs)) {
    throw new Error(`目标已存在: ${toRelative}`)
  }
  const parent = dirname(toAbs)
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true })
  }
  renameSync(fromAbs, toAbs)
  console.log(`[Agent 工作区] Skill 子项重命名: ${workspaceSlug}/${skillSlug}: ${fromRelative} → ${toRelative}`)
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

// ===== 工作区配置管理 =====

interface WorkspaceConfig {
  attachedDirectories?: string[]
  attachedFiles?: string[]
  worktreeRepos?: import('@proma/shared').WorkspaceWorktreeRepo[]
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
    const data = JSON.parse(raw) as Partial<WorkspaceConfig>
    return {
      attachedDirectories: Array.isArray(data.attachedDirectories)
        ? data.attachedDirectories.filter((dir): dir is string => typeof dir === 'string')
        : undefined,
      attachedFiles: Array.isArray(data.attachedFiles)
        ? data.attachedFiles.filter((file): file is string => typeof file === 'string')
        : undefined,
      worktreeRepos: Array.isArray(data.worktreeRepos)
        ? data.worktreeRepos.filter((r) => r && typeof r.name === 'string' && typeof r.repoPath === 'string' && typeof r.worktreesPath === 'string')
        : undefined,
    }
  } catch {
    return {}
  }
}

function writeWorkspaceConfig(workspaceSlug: string, config: WorkspaceConfig): void {
  const configPath = getWorkspaceConfigPath(workspaceSlug)
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
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

// ===== 工作区级附加文件管理 =====

export function getWorkspaceAttachedFiles(workspaceSlug: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  return config.attachedFiles ?? []
}

export function attachWorkspaceFile(workspaceSlug: string, filePath: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  const existing = config.attachedFiles ?? []

  if (existing.includes(filePath)) {
    return existing
  }

  const updated = [...existing, filePath]
  writeWorkspaceConfig(workspaceSlug, { ...config, attachedFiles: updated })
  console.log(`[Agent 工作区] 已附加工作区文件: ${filePath} → ${workspaceSlug}`)
  return updated
}

export function detachWorkspaceFile(workspaceSlug: string, filePath: string): string[] {
  const config = readWorkspaceConfig(workspaceSlug)
  const existing = config.attachedFiles ?? []
  const updated = existing.filter((f) => f !== filePath)
  writeWorkspaceConfig(workspaceSlug, { ...config, attachedFiles: updated })
  console.log(`[Agent 工作区] 已移除工作区文件: ${filePath} ← ${workspaceSlug}`)
  return updated
}

// ===== 工作区级 Worktree 仓库管理 =====

/**
 * 获取工作区的 Worktree 仓库列表。
 *
 * 优先从工作区的「附加目录」中自动探测 git 仓库根，避免依赖手动维护的
 * worktreeRepos 配置（其 repoPath 容易因仓库移动而失效，导致 WorktreeSelector
 * 静默找不到 worktree）。同时保留 config 中仍然存在的手动配置项（如不在附加
 * 目录内的额外仓库），并自动过滤掉路径已不存在的陈旧条目。
 */
export async function getWorktreeRepos(workspaceSlug: string): Promise<import('@proma/shared').WorkspaceWorktreeRepo[]> {
  const config = readWorkspaceConfig(workspaceSlug)

  // repoPath 归一化后去重
  const byPath = new Map<string, import('@proma/shared').WorkspaceWorktreeRepo>()

  // 1. 从附加目录自动探测 git 仓库根
  const attachedDirs = config.attachedDirectories ?? []
  for (const dir of attachedDirs) {
    let roots: string[]
    try {
      roots = await findAllGitRoots(dir)
    } catch {
      continue
    }
    for (const root of roots) {
      if (!byPath.has(root)) {
        byPath.set(root, {
          name: basename(root),
          repoPath: root,
          worktreesPath: '',
          priority: 1,
        })
      }
    }
  }

  // 2. 合并手动配置中仍然存在的仓库（自动过滤失效路径）
  for (const repo of config.worktreeRepos ?? []) {
    const normalized = normalizeGitRoot(repo.repoPath)
    if (!byPath.has(normalized) && existsSync(repo.repoPath)) {
      byPath.set(normalized, repo)
    }
  }

  return Array.from(byPath.values()).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
}

export function addWorktreeRepo(workspaceSlug: string, repo: import('@proma/shared').WorkspaceWorktreeRepo): import('@proma/shared').WorkspaceWorktreeRepo[] {
  const config = readWorkspaceConfig(workspaceSlug)
  const existing = config.worktreeRepos ?? []

  if (existing.some((r) => r.repoPath === repo.repoPath)) {
    return existing
  }

  const updated = [...existing, repo]
  writeWorkspaceConfig(workspaceSlug, { ...config, worktreeRepos: updated })
  console.log(`[Agent 工作区] 已添加 worktree 仓库: ${repo.name} (${repo.repoPath}) → ${workspaceSlug}`)
  return updated
}

export function removeWorktreeRepo(workspaceSlug: string, repoPath: string): import('@proma/shared').WorkspaceWorktreeRepo[] {
  const config = readWorkspaceConfig(workspaceSlug)
  const existing = config.worktreeRepos ?? []
  const updated = existing.filter((r) => r.repoPath !== repoPath)
  writeWorkspaceConfig(workspaceSlug, { ...config, worktreeRepos: updated })
  console.log(`[Agent 工作区] 已移除 worktree 仓库: ${repoPath} ← ${workspaceSlug}`)
  return updated
}

/**
 * 清理所有工作区中不存在的附加目录和附加文件
 * @returns 清理的条目总数
 */
export function cleanupStaleWorkspaceAttachedPaths(): number {
  const workspaces = listAgentWorkspaces()
  let count = 0

  for (const ws of workspaces) {
    const config = readWorkspaceConfig(ws.slug)
    let changed = false

    if (config.attachedDirectories?.length) {
      const valid = config.attachedDirectories.filter((d) => existsSync(d))
      if (valid.length < config.attachedDirectories.length) {
        count += config.attachedDirectories.length - valid.length
        config.attachedDirectories = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (config.attachedFiles?.length) {
      const valid = config.attachedFiles.filter((f) => existsSync(f))
      if (valid.length < config.attachedFiles.length) {
        count += config.attachedFiles.length - valid.length
        config.attachedFiles = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (changed) {
      writeWorkspaceConfig(ws.slug, config)
    }
  }

  if (count > 0) {
    console.log(`[Agent 工作区] 清理了 ${count} 个不存在的附加路径`)
  }

  return count
}
