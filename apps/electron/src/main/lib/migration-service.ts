/**
 * 数据迁移服务
 *
 * 支持两种导出模式：
 * - personal (.proma-backup)：个人全量备份，含解密后的 API Key 明文
 * - share (.proma-share)：团队分发，自由选择组件，凭据自动剥离
 *
 * 导入时自动检测跨平台差异并提示用户处理路径映射。
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync, type Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir, platform, arch, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { safeStorage } from 'electron'
import {
  getConfigDir,
  getChannelsPath,
  getConversationsIndexPath,
  getConversationsDir,
  getConversationMessagesPath,
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentSessionMessagesPath,
  getAgentWorkspacePath,
  getAgentSessionWorkspacePath,
  getWorkspaceMcpPath,
  getWorkspaceSkillsDir,
  getInactiveSkillsDir,
  getSettingsPath,
  getUserProfilePath,
  getChatToolsConfigPath,
} from './config-paths'
import { listAgentWorkspaces, getAgentWorkspace, getAllWorkspaceSkills, getWorkspaceMcpConfig } from './agent-workspace-manager'
import { listChannels, decryptApiKey } from './channel-manager'
import type { AgentWorkspace } from '@proma/shared'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type MigrationMode = 'personal' | 'share'
export type MigrationComponent = 'sessions' | 'skills' | 'mcp' | 'channels' | 'chattools'

export interface ExportOptions {
  mode: MigrationMode
  workspaceId: string
  components: MigrationComponent[]
  /** 为空则导出全量会话 */
  sessionIds?: string[]
  outputPath: string
}

export interface ExportResult {
  success: boolean
  filePath: string
  warnings?: string[]
}

export interface ExportPreview {
  workspace: AgentWorkspace | null
  agentSessionCount: number
  chatConversationCount: number
  skillCount: number
  hasMcp: boolean
  estimatedComponents: MigrationComponent[]
}

export interface PathCheckResult {
  path: string
  exists: boolean
  suggested?: string
}

export interface ImportPreview {
  manifest: MigrationManifest
  agentSessionCount: number
  chatConversationCount: number
  skillNames: string[]
  hasMcp: boolean
  crossPlatform: boolean
  pathCheckResults: PathCheckResult[]
  tempDir: string
}

export interface ConfirmImportOptions {
  tempDir: string
  manifest: MigrationManifest
  targetWorkspaceId?: string
  createNewWorkspace?: boolean
  newWorkspaceName?: string
  /** key: 原始路径, value: 新路径 (null = 移除) */
  pathMappings: Record<string, string | null>
  conflictResolution?: 'overwrite' | 'skip'
}

interface MigrationManifest {
  mode: MigrationMode
  version: string
  components: MigrationComponent[]
  exportedAt: number
  sourcePlatform: string
  sourceArch: string
  sourceHomeDir: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
}

// ─── v2 多工作区类型 ─────────────────────────────────────────────────────────

export interface WorkspaceExportEntry {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  skillSlugs: string[] | 'all'
  mcpServerNames: string[] | 'all'
}

interface MigrationManifestV2 {
  mode: MigrationMode
  version: '2.0'
  components: MigrationComponent[]
  exportedAt: number
  sourcePlatform: string
  sourceArch: string
  sourceHomeDir: string
  workspaces: WorkspaceExportEntry[]
}

export interface ExportOptionsV2 {
  mode: MigrationMode
  components: MigrationComponent[]
  outputPath: string
  sessionIds?: string[]
  workspaceSelections?: WorkspaceSelection[]
}

export interface WorkspaceSelection {
  workspaceId: string
  skillSlugs?: string[]
  mcpServerNames?: string[]
}

export interface ShareExportPreview {
  workspaces: ShareExportWorkspacePreview[]
  agentSessionCount: number
  chatConversationCount: number
}

export interface ShareExportWorkspacePreview {
  workspace: AgentWorkspace
  skills: Array<{ slug: string; name: string; enabled: boolean }>
  mcpServers: Array<{ name: string; enabled: boolean; type: string }>
}

export interface WorkspaceImportPreview {
  workspaceSlug: string
  workspaceName: string
  skillNames: string[]
  mcpServerNames: string[]
  existsLocally: boolean
  localWorkspaceId?: string
  conflictingSkills: string[]
  conflictingMcpServers: string[]
}

export interface ImportPreviewV2 {
  manifest: MigrationManifestV2
  agentSessionCount: number
  chatConversationCount: number
  workspaces: WorkspaceImportPreview[]
  crossPlatform: boolean
  pathCheckResults: PathCheckResult[]
  tempDir: string
}

export interface WorkspaceImportMapping {
  sourceSlug: string
  action: 'merge' | 'create' | 'skip'
  targetWorkspaceId?: string
  newWorkspaceName?: string
}

export interface ConfirmImportOptionsV2 {
  tempDir: string
  manifest: MigrationManifestV2 | MigrationManifest
  pathMappings: Record<string, string | null>
  workspaceMappings?: WorkspaceImportMapping[]
  targetWorkspaceId?: string
  createNewWorkspace?: boolean
  newWorkspaceName?: string
  conflictResolution?: 'overwrite' | 'skip'
}

// ─── 导出 ────────────────────────────────────────────────────────────────────

export async function getExportPreview(workspaceId: string): Promise<ExportPreview> {
  const workspace = getAgentWorkspace(workspaceId) ?? null

  let agentSessionCount = 0
  let chatConversationCount = 0
  let skillCount = 0
  let hasMcp = false

  if (workspace) {
    // 统计 Agent 会话
    const sessionsIndex = readJsonSafe<{ sessions: Array<{ workspaceId: string }> }>(getAgentSessionsIndexPath())
    agentSessionCount = (sessionsIndex?.sessions ?? []).filter((s) => s.workspaceId === workspaceId).length

    // 统计 Chat 对话（全量，不按工作区过滤）
    const convIndex = readJsonSafe<{ conversations: unknown[] }>(getConversationsIndexPath())
    chatConversationCount = (convIndex?.conversations ?? []).length

    // 统计 Skills
    const skillsDir = getWorkspaceSkillsDir(workspace.slug)
    if (existsSync(skillsDir)) {
      skillCount = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
    }

    // 检查 MCP
    const mcpPath = getWorkspaceMcpPath(workspace.slug)
    hasMcp = existsSync(mcpPath)
  }

  return {
    workspace,
    agentSessionCount,
    chatConversationCount,
    skillCount,
    hasMcp,
    estimatedComponents: ['sessions', 'skills', 'mcp', 'channels', 'chattools'],
  }
}

export async function getShareExportPreview(): Promise<ShareExportPreview> {
  const allWorkspaces = listAgentWorkspaces()

  const workspaces: ShareExportWorkspacePreview[] = allWorkspaces.map((ws) => {
    const skills = getAllWorkspaceSkills(ws.slug).map((s) => ({
      slug: s.slug,
      name: s.name,
      enabled: s.enabled,
    }))
    const mcpConfig = getWorkspaceMcpConfig(ws.slug)
    const mcpServers = Object.entries(mcpConfig.servers ?? {}).map(([name, entry]) => ({
      name,
      enabled: entry.enabled,
      type: entry.type,
    }))
    return { workspace: ws, skills, mcpServers }
  })

  const sessionsIndex = readJsonSafe<{ sessions: unknown[] }>(getAgentSessionsIndexPath())
  const agentSessionCount = (sessionsIndex?.sessions ?? []).length

  const convIndex = readJsonSafe<{ conversations: unknown[] }>(getConversationsIndexPath())
  const chatConversationCount = (convIndex?.conversations ?? []).length

  return { workspaces, agentSessionCount, chatConversationCount }
}

export async function exportData(options: ExportOptions): Promise<ExportResult> {
  const { mode, workspaceId, components, sessionIds, outputPath } = options
  const warnings: string[] = []

  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) throw new Error(`工作区不存在: ${workspaceId}`)

  const manifest: MigrationManifest = {
    mode,
    version: '1.0',
    components,
    exportedAt: Date.now(),
    sourcePlatform: platform(),
    sourceArch: arch(),
    sourceHomeDir: homedir(),
    workspaceId,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
  }

  const zip = new AdmZip()

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))

  if (components.includes('sessions')) _addSessions(zip, workspace, sessionIds, warnings)
  if (components.includes('skills')) _addSkills(zip, workspace, warnings)
  if (components.includes('mcp')) _addMcp(zip, workspace, mode)
  if (components.includes('channels')) _addChannels(zip, mode)
  if (components.includes('chattools')) _addChatTools(zip, mode)
  _addWorkspaceConfig(zip, workspace)
  if (mode === 'personal') _addPersonalFiles(zip)

  zip.writeZip(outputPath)
  return buildExportResult(outputPath, warnings)
}

export async function exportDataV2(options: ExportOptionsV2): Promise<ExportResult> {
  const { mode, components, sessionIds, outputPath, workspaceSelections } = options
  const warnings: string[] = []

  const allWorkspaces = listAgentWorkspaces()
  const wsMap = new Map(allWorkspaces.map((w) => [w.id, w]))

  let targetWorkspaces: Array<{ workspace: AgentWorkspace; skillSlugs?: string[]; mcpServerNames?: string[] }>

  if (workspaceSelections && workspaceSelections.length > 0) {
    targetWorkspaces = workspaceSelections
      .map((sel) => {
        const ws = wsMap.get(sel.workspaceId)
        if (!ws) return null
        return { workspace: ws, skillSlugs: sel.skillSlugs, mcpServerNames: sel.mcpServerNames }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  } else {
    targetWorkspaces = allWorkspaces.map((ws) => ({ workspace: ws }))
  }

  if (targetWorkspaces.length === 0) throw new Error('没有可导出的工作区')

  const workspaceEntries: WorkspaceExportEntry[] = targetWorkspaces.map(({ workspace, skillSlugs, mcpServerNames }) => ({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    skillSlugs: skillSlugs ?? 'all',
    mcpServerNames: mcpServerNames ?? 'all',
  }))

  const manifest: MigrationManifestV2 = {
    mode,
    version: '2.0',
    components,
    exportedAt: Date.now(),
    sourcePlatform: platform(),
    sourceArch: arch(),
    sourceHomeDir: homedir(),
    workspaces: workspaceEntries,
  }

  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))

  if (components.includes('sessions')) {
    _addSessionsMultiWorkspace(zip, targetWorkspaces.map((t) => t.workspace), sessionIds, warnings)
  }

  if (components.includes('skills')) {
    for (const { workspace, skillSlugs } of targetWorkspaces) {
      _addSkillsV2(zip, workspace, skillSlugs, warnings)
    }
  }

  if (components.includes('mcp')) {
    for (const { workspace, mcpServerNames } of targetWorkspaces) {
      _addMcpV2(zip, workspace, mode, mcpServerNames)
    }
  }

  for (const { workspace } of targetWorkspaces) {
    _addWorkspaceConfigV2(zip, workspace)
  }

  if (components.includes('channels')) _addChannels(zip, mode)
  if (components.includes('chattools')) _addChatTools(zip, mode)
  if (mode === 'personal') _addPersonalFiles(zip)

  zip.writeZip(outputPath)
  return buildExportResult(outputPath, warnings)
}

function _addSessions(zip: AdmZip, workspace: AgentWorkspace, filterIds: string[] | undefined, warnings: string[]) {
  const sessionsIndexPath = getAgentSessionsIndexPath()
  if (existsSync(sessionsIndexPath)) {
    const index = readJsonSafe<{ version: number; sessions: Array<{ id: string; workspaceId: string }> }>(sessionsIndexPath)
    const sessions = (index?.sessions ?? []).filter((s) => s.workspaceId === workspace.id)
    const targets = filterIds ? sessions.filter((s) => filterIds.includes(s.id)) : sessions
    const exportedIds = new Set<string>()

    for (const session of targets) {
      const msgPath = getAgentSessionMessagesPath(session.id)
      if (existsSync(msgPath)) {
        zip.addLocalFile(msgPath, 'sessions/agent')
        exportedIds.add(session.id)
      }
      const workDir = join(getAgentWorkspacePath(workspace.slug), session.id)
      if (existsSync(workDir)) {
        _addDirToZip(zip, workDir, `sessions/workspace-data/${session.id}`, warnings)
      }
    }

    if (index) {
      const filtered = { ...index, sessions: index.sessions.filter((s) => exportedIds.has(s.id)) }
      zip.addFile('sessions/agent-sessions-index.json', Buffer.from(JSON.stringify(filtered, null, 2), 'utf-8'))
    }
  }

  const convIndexPath = getConversationsIndexPath()
  if (existsSync(convIndexPath)) {
    const index = readJsonSafe<{ version: number; conversations: Array<{ id: string }> }>(convIndexPath)
    const conversations = index?.conversations ?? []
    const targets = filterIds ? conversations.filter((c) => filterIds.includes(c.id)) : conversations

    for (const conv of targets) {
      const msgPath = getConversationMessagesPath(conv.id)
      if (existsSync(msgPath)) {
        zip.addLocalFile(msgPath, 'sessions/chat')
      }
    }
    zip.addFile('sessions/conversations-index.json', Buffer.from(JSON.stringify({ ...index, conversations: targets }, null, 2), 'utf-8'))
  }
}

function _addSessionsMultiWorkspace(zip: AdmZip, workspaces: AgentWorkspace[], filterIds: string[] | undefined, warnings: string[]) {
  const wsIds = new Set(workspaces.map((w) => w.id))

  const sessionsIndexPath = getAgentSessionsIndexPath()
  if (existsSync(sessionsIndexPath)) {
    const index = readJsonSafe<{ version: number; sessions: Array<{ id: string; workspaceId: string }> }>(sessionsIndexPath)
    const sessions = (index?.sessions ?? []).filter((s) => wsIds.has(s.workspaceId))
    const targets = filterIds ? sessions.filter((s) => filterIds.includes(s.id)) : sessions
    const exportedIds = new Set<string>()

    for (const session of targets) {
      const msgPath = getAgentSessionMessagesPath(session.id)
      if (existsSync(msgPath)) {
        zip.addLocalFile(msgPath, 'sessions/agent')
        exportedIds.add(session.id)
      }
      const ws = workspaces.find((w) => w.id === session.workspaceId)
      if (ws) {
        const workDir = join(getAgentWorkspacePath(ws.slug), session.id)
        if (existsSync(workDir)) {
          _addDirToZip(zip, workDir, `sessions/workspace-data/${session.id}`, warnings)
        }
      }
    }

    if (index) {
      const filtered = { ...index, sessions: index.sessions.filter((s) => exportedIds.has(s.id)) }
      zip.addFile('sessions/agent-sessions-index.json', Buffer.from(JSON.stringify(filtered, null, 2), 'utf-8'))
    }
  }

  const convIndexPath = getConversationsIndexPath()
  if (existsSync(convIndexPath)) {
    const index = readJsonSafe<{ version: number; conversations: Array<{ id: string }> }>(convIndexPath)
    const conversations = index?.conversations ?? []
    const targets = filterIds ? conversations.filter((c) => filterIds.includes(c.id)) : conversations

    for (const conv of targets) {
      const msgPath = getConversationMessagesPath(conv.id)
      if (existsSync(msgPath)) {
        zip.addLocalFile(msgPath, 'sessions/chat')
      }
    }
    zip.addFile('sessions/conversations-index.json', Buffer.from(JSON.stringify({ ...index, conversations: targets }, null, 2), 'utf-8'))
  }
}

function _addSkills(zip: AdmZip, workspace: AgentWorkspace, warnings: string[]) {
  const skillsDir = getWorkspaceSkillsDir(workspace.slug)
  if (existsSync(skillsDir)) _addDirToZip(zip, skillsDir, 'skills/active', warnings)
  const inactiveDir = getInactiveSkillsDir(workspace.slug)
  if (existsSync(inactiveDir)) _addDirToZip(zip, inactiveDir, 'skills/inactive', warnings)
}

function _addMcp(zip: AdmZip, workspace: AgentWorkspace, mode: MigrationMode) {
  const mcpPath = getWorkspaceMcpPath(workspace.slug)
  if (!existsSync(mcpPath)) return

  if (mode === 'share') {
    const config = readJsonSafe<Record<string, unknown>>(mcpPath)
    if (config) {
      zip.addFile('config/mcp.json', Buffer.from(JSON.stringify(_scrubMcpCredentials(config), null, 2), 'utf-8'))
    }
  } else {
    zip.addLocalFile(mcpPath, 'config')
  }
}

function _scrubMcpCredentials(config: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = /token|key|secret|password|auth|credential/i
  const scrub = (obj: unknown): unknown => {
    if (typeof obj !== 'object' || obj === null) return obj
    if (Array.isArray(obj)) return obj.map(scrub)
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (sensitiveKeys.test(k) && typeof v === 'string') {
        result[k] = ''
      } else {
        result[k] = scrub(v)
      }
    }
    return result
  }
  return scrub(config) as Record<string, unknown>
}

function _addChannels(zip: AdmZip, mode: MigrationMode) {
  const channelsPath = getChannelsPath()
  if (!existsSync(channelsPath)) return

  if (mode === 'personal') {
    const channels = listChannels()
    const decrypted = channels.map((ch) => {
      try { return { ...ch, apiKey: decryptApiKey(ch.id) } }
      catch { return { ...ch, apiKey: '' } }
    })
    const config = readJsonSafe<{ version: number }>(channelsPath) ?? { version: 1 }
    zip.addFile('config/channels.json', Buffer.from(JSON.stringify({ ...config, channels: decrypted }, null, 2), 'utf-8'))
  } else {
    const channels = listChannels().map((ch) => ({ ...ch, apiKey: '' }))
    const config = readJsonSafe<{ version: number }>(channelsPath) ?? { version: 1 }
    zip.addFile('config/channels.json', Buffer.from(JSON.stringify({ ...config, channels }, null, 2), 'utf-8'))
  }
}

function _addChatTools(zip: AdmZip, mode: MigrationMode) {
  const toolsPath = getChatToolsConfigPath()
  if (!existsSync(toolsPath)) return

  if (mode === 'share') {
    const config = readJsonSafe<{ toolStates?: unknown; toolCredentials?: unknown; customTools?: unknown }>(toolsPath)
    if (config) {
      zip.addFile('config/chat-tools.json', Buffer.from(JSON.stringify({ ...config, toolCredentials: {} }, null, 2), 'utf-8'))
    }
  } else {
    zip.addLocalFile(toolsPath, 'config')
  }
}

function _addWorkspaceConfig(zip: AdmZip, workspace: AgentWorkspace) {
  const configPath = join(getAgentWorkspacePath(workspace.slug), 'config.json')
  if (existsSync(configPath)) {
    zip.addLocalFile(configPath, 'config', 'workspace-config.json')
  }
  zip.addFile('config/workspace-meta.json', Buffer.from(JSON.stringify(workspace, null, 2), 'utf-8'))
}

// ─── v2 导出辅助函数 ─────────────────────────────────────────────────────────

function _addSkillsV2(zip: AdmZip, workspace: AgentWorkspace, selectedSlugs: string[] | undefined, warnings: string[]) {
  const prefix = `workspaces/${workspace.slug}`
  const skillsDir = getWorkspaceSkillsDir(workspace.slug)
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (selectedSlugs && !selectedSlugs.includes(entry.name)) continue
      _addDirToZip(zip, join(skillsDir, entry.name), `${prefix}/skills/active/${entry.name}`, warnings)
    }
  }
  const inactiveDir = getInactiveSkillsDir(workspace.slug)
  if (existsSync(inactiveDir)) {
    for (const entry of readdirSync(inactiveDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (selectedSlugs && !selectedSlugs.includes(entry.name)) continue
      _addDirToZip(zip, join(inactiveDir, entry.name), `${prefix}/skills/inactive/${entry.name}`, warnings)
    }
  }
}

function _addMcpV2(zip: AdmZip, workspace: AgentWorkspace, mode: MigrationMode, selectedNames?: string[]) {
  const prefix = `workspaces/${workspace.slug}`
  const mcpPath = getWorkspaceMcpPath(workspace.slug)
  if (!existsSync(mcpPath)) return

  const raw = readJsonSafe<{ servers?: Record<string, unknown> }>(mcpPath)
  if (!raw?.servers) return

  let servers = raw.servers
  if (selectedNames) {
    const filtered: Record<string, unknown> = {}
    for (const name of selectedNames) {
      if (servers[name]) filtered[name] = servers[name]
    }
    servers = filtered
  }

  const config = { servers }
  const output = mode === 'share' ? _scrubMcpCredentials(config as Record<string, unknown>) : config
  zip.addFile(`${prefix}/config/mcp.json`, Buffer.from(JSON.stringify(output, null, 2), 'utf-8'))
}

function _addWorkspaceConfigV2(zip: AdmZip, workspace: AgentWorkspace) {
  const prefix = `workspaces/${workspace.slug}`
  const configPath = join(getAgentWorkspacePath(workspace.slug), 'config.json')
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf-8')
    zip.addFile(`${prefix}/config/workspace-config.json`, Buffer.from(content, 'utf-8'))
  }
  zip.addFile(`${prefix}/config/workspace-meta.json`, Buffer.from(JSON.stringify(workspace, null, 2), 'utf-8'))
}

function _addPersonalFiles(zip: AdmZip) {
  const files: Array<[string, string, string]> = [
    [getSettingsPath(), 'auth', 'settings.json'],
    [getUserProfilePath(), 'auth', 'user-profile.json'],
    [join(getConfigDir(), 'cloud-auth.json'), 'auth', 'cloud-auth.json'],
  ]
  for (const [src, zipDir, zipName] of files) {
    if (existsSync(src)) zip.addLocalFile(src, zipDir, zipName)
  }
}

// ─── 导入（解析预览）────────────────────────────────────────────────────────

export async function parseImportFile(filePath: string): Promise<ImportPreview | ImportPreviewV2> {
  const tempDir = join(tmpdir(), `proma-import-${randomUUID()}`)
  mkdirSync(tempDir, { recursive: true })

  const zip = new AdmZip(filePath)
  _safeExtractAll(zip, tempDir)

  const manifestPath = join(tempDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    rmSync(tempDir, { recursive: true, force: true })
    throw new Error('无效的迁移文件：缺少 manifest.json')
  }

  const rawManifest = readJsonSafe<MigrationManifest & { workspaces?: WorkspaceExportEntry[] }>(manifestPath)
  if (!rawManifest) {
    rmSync(tempDir, { recursive: true, force: true })
    throw new Error('无法解析 manifest.json')
  }

  let agentSessionCount = 0
  let chatConversationCount = 0
  const agentDir = join(tempDir, 'sessions/agent')
  const chatDir = join(tempDir, 'sessions/chat')
  if (existsSync(agentDir)) {
    agentSessionCount = readdirSync(agentDir).filter((f) => f.endsWith('.jsonl')).length
  }
  if (existsSync(chatDir)) {
    chatConversationCount = readdirSync(chatDir).filter((f) => f.endsWith('.jsonl')).length
  }

  const crossPlatform = rawManifest.sourcePlatform !== platform()

  if (rawManifest.version === '2.0' && rawManifest.workspaces) {
    const manifest = rawManifest as unknown as MigrationManifestV2
    const localWorkspaces = listAgentWorkspaces()
    const localBySlug = new Map(localWorkspaces.map((w) => [w.slug, w]))

    const workspacesDir = join(tempDir, 'workspaces')
    const wsPreviewList: WorkspaceImportPreview[] = manifest.workspaces.map((entry) => {
      const wsDir = join(workspacesDir, entry.workspaceSlug)
      const skillsDir = join(wsDir, 'skills/active')
      const skillNames = existsSync(skillsDir)
        ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
        : []

      const mcpPath = join(wsDir, 'config/mcp.json')
      const mcpConfig = existsSync(mcpPath) ? readJsonSafe<{ servers?: Record<string, unknown> }>(mcpPath) : null
      const mcpServerNames = mcpConfig?.servers ? Object.keys(mcpConfig.servers) : []

      const localWs = localBySlug.get(entry.workspaceSlug)

      let conflictingSkills: string[] = []
      let conflictingMcpServers: string[] = []

      if (localWs) {
        const localSkillsDir = getWorkspaceSkillsDir(localWs.slug)
        if (existsSync(localSkillsDir)) {
          const localSkillSet = new Set(
            readdirSync(localSkillsDir, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => e.name)
          )
          conflictingSkills = skillNames.filter((name) => localSkillSet.has(name))
        }

        const localMcpPath = getWorkspaceMcpPath(localWs.slug)
        if (existsSync(localMcpPath)) {
          const localMcp = readJsonSafe<{ servers?: Record<string, unknown> }>(localMcpPath)
          if (localMcp?.servers) {
            const localServerSet = new Set(Object.keys(localMcp.servers))
            conflictingMcpServers = mcpServerNames.filter((name) => localServerSet.has(name))
          }
        }
      }

      return {
        workspaceSlug: entry.workspaceSlug,
        workspaceName: entry.workspaceName,
        skillNames,
        mcpServerNames,
        existsLocally: !!localWs,
        localWorkspaceId: localWs?.id,
        conflictingSkills,
        conflictingMcpServers,
      }
    })

    const pathCheckResults = _checkAttachedDirectoriesV2(tempDir, manifest)

    return {
      manifest,
      agentSessionCount,
      chatConversationCount,
      workspaces: wsPreviewList,
      crossPlatform,
      pathCheckResults,
      tempDir,
    } satisfies ImportPreviewV2
  }

  // v1.0 原有逻辑
  const manifest = rawManifest as MigrationManifest
  const skillsDir = join(tempDir, 'skills/active')
  const skillNames: string[] = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : []

  const hasMcp = existsSync(join(tempDir, 'config/mcp.json'))
  const pathCheckResults = _checkAttachedDirectories(tempDir, manifest)

  return {
    manifest,
    agentSessionCount,
    chatConversationCount,
    skillNames,
    hasMcp,
    crossPlatform,
    pathCheckResults,
    tempDir,
  }
}

function _checkAttachedDirectories(tempDir: string, manifest: MigrationManifest): PathCheckResult[] {
  const configPath = join(tempDir, 'config/workspace-config.json')
  if (!existsSync(configPath)) return []

  const config = readJsonSafe<{ attachedDirectories?: string[] }>(configPath)
  if (!config?.attachedDirectories?.length) return []

  const currentHome = homedir()

  return config.attachedDirectories.map((p) => {
    let suggested: string | undefined
    if (manifest.sourceHomeDir && p.startsWith(manifest.sourceHomeDir)) {
      suggested = join(currentHome, p.slice(manifest.sourceHomeDir.length))
    }

    const checkPath = suggested ?? p
    return {
      path: p,
      exists: existsSync(checkPath),
      suggested,
    }
  })
}

function _checkAttachedDirectoriesV2(tempDir: string, manifest: MigrationManifestV2): PathCheckResult[] {
  const currentHome = homedir()
  const allResults: PathCheckResult[] = []
  const seen = new Set<string>()

  for (const wsEntry of manifest.workspaces) {
    const configPath = join(tempDir, `workspaces/${wsEntry.workspaceSlug}/config/workspace-config.json`)
    if (!existsSync(configPath)) continue

    const config = readJsonSafe<{ attachedDirectories?: string[] }>(configPath)
    if (!config?.attachedDirectories?.length) continue

    for (const p of config.attachedDirectories) {
      if (seen.has(p)) continue
      seen.add(p)

      let suggested: string | undefined
      if (manifest.sourceHomeDir && p.startsWith(manifest.sourceHomeDir)) {
        suggested = join(currentHome, p.slice(manifest.sourceHomeDir.length))
      }
      const checkPath = suggested ?? p
      allResults.push({ path: p, exists: existsSync(checkPath), suggested })
    }
  }

  return allResults
}

// ─── 导入（确认执行）────────────────────────────────────────────────────────

export async function confirmImport(options: ConfirmImportOptions | ConfirmImportOptionsV2): Promise<{ success: boolean }> {
  const { tempDir, manifest, pathMappings } = options

  try {
    if (manifest.version === '2.0' && 'workspaces' in manifest) {
      return await _confirmImportV2(options as ConfirmImportOptionsV2)
    }

    // v1.0 原有逻辑
    const { targetWorkspaceId, createNewWorkspace, newWorkspaceName, conflictResolution } = options as ConfirmImportOptions
    const overwrite = conflictResolution === 'overwrite'
    let targetWorkspace: AgentWorkspace | undefined
    if (createNewWorkspace) {
      const { createAgentWorkspace } = await import('./agent-workspace-manager')
      targetWorkspace = createAgentWorkspace(newWorkspaceName ?? (manifest as MigrationManifest).workspaceName)
    } else if (targetWorkspaceId) {
      targetWorkspace = getAgentWorkspace(targetWorkspaceId)
    } else {
      const workspaces = listAgentWorkspaces()
      targetWorkspace = workspaces.find((w) => w.slug === (manifest as MigrationManifest).workspaceSlug) ?? workspaces[0]
    }

    if (!targetWorkspace) throw new Error('无法确定目标工作区')

    if (manifest.components.includes('sessions')) {
      await _importSessions(tempDir, targetWorkspace)
    }
    if (manifest.components.includes('skills')) {
      _importSkills(tempDir, targetWorkspace, overwrite)
    }
    if (manifest.components.includes('mcp')) {
      _importMcp(tempDir, targetWorkspace, overwrite)
    }
    if (manifest.components.includes('channels')) {
      _importChannels(tempDir, manifest.mode)
    }
    if (manifest.components.includes('chattools')) {
      _importChatTools(tempDir)
    }
    _importWorkspaceConfig(tempDir, targetWorkspace, pathMappings)
    if (manifest.mode === 'personal') {
      _importPersonalFiles(tempDir)
    }

    return { success: true }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // 忽略清理失败
    }
  }
}

async function _confirmImportV2(options: ConfirmImportOptionsV2): Promise<{ success: boolean }> {
  const { tempDir, manifest, pathMappings, workspaceMappings, conflictResolution } = options
  const v2Manifest = manifest as MigrationManifestV2
  const overwrite = conflictResolution === 'overwrite'

  const { createAgentWorkspace } = await import('./agent-workspace-manager')

  const localWorkspaces = listAgentWorkspaces()
  const localBySlug = new Map(localWorkspaces.map((w) => [w.slug, w]))

  const resolvedMappings: Array<{ sourceSlug: string; target: AgentWorkspace }> = []

  if (workspaceMappings && workspaceMappings.length > 0) {
    for (const mapping of workspaceMappings) {
      if (mapping.action === 'skip') continue
      if (mapping.action === 'merge') {
        const target = mapping.targetWorkspaceId
          ? getAgentWorkspace(mapping.targetWorkspaceId)
          : localBySlug.get(mapping.sourceSlug)
        if (!target) continue
        resolvedMappings.push({ sourceSlug: mapping.sourceSlug, target })
      } else if (mapping.action === 'create') {
        const wsEntry = v2Manifest.workspaces.find((w) => w.workspaceSlug === mapping.sourceSlug)
        const name = mapping.newWorkspaceName ?? wsEntry?.workspaceName ?? mapping.sourceSlug
        const target = createAgentWorkspace(name)
        resolvedMappings.push({ sourceSlug: mapping.sourceSlug, target })
      }
    }
  } else {
    for (const wsEntry of v2Manifest.workspaces) {
      const local = localBySlug.get(wsEntry.workspaceSlug)
      if (local) {
        resolvedMappings.push({ sourceSlug: wsEntry.workspaceSlug, target: local })
      } else {
        const target = createAgentWorkspace(wsEntry.workspaceName)
        resolvedMappings.push({ sourceSlug: wsEntry.workspaceSlug, target })
      }
    }
  }

  for (const { sourceSlug, target } of resolvedMappings) {
    if (v2Manifest.components.includes('skills')) {
      _importSkillsV2(tempDir, sourceSlug, target, overwrite)
    }
    if (v2Manifest.components.includes('mcp')) {
      _importMcpV2(tempDir, sourceSlug, target, overwrite)
    }
    _importWorkspaceConfigV2(tempDir, sourceSlug, target, pathMappings)
  }

  if (v2Manifest.components.includes('sessions') && resolvedMappings.length > 0) {
    const wsIdMap = new Map<string, AgentWorkspace>()
    for (const wsEntry of v2Manifest.workspaces) {
      const resolved = resolvedMappings.find((r) => r.sourceSlug === wsEntry.workspaceSlug)
      if (resolved) wsIdMap.set(wsEntry.workspaceId, resolved.target)
    }
    await _importSessionsV2(tempDir, wsIdMap, resolvedMappings[0]!.target)
  }
  if (v2Manifest.components.includes('channels')) {
    _importChannels(tempDir, v2Manifest.mode)
  }
  if (v2Manifest.components.includes('chattools')) {
    _importChatTools(tempDir)
  }
  if (v2Manifest.mode === 'personal') {
    _importPersonalFiles(tempDir)
  }

  return { success: true }
}

async function _importSessions(tempDir: string, targetWorkspace: AgentWorkspace) {
  // Agent 会话
  const agentDir = join(tempDir, 'sessions/agent')
  const agentSessionsDir = getAgentSessionsDir()
  if (existsSync(agentDir)) {
    for (const file of readdirSync(agentDir)) {
      if (!file.endsWith('.jsonl')) continue
      const src = join(agentDir, file)
      const dest = join(agentSessionsDir, file)
      if (!existsSync(dest)) {
        cpSync(src, dest)
      }
    }
  }

  // Agent sessions index 合并
  const importedIndexPath = join(tempDir, 'sessions/agent-sessions-index.json')
  if (existsSync(importedIndexPath)) {
    const imported = readJsonSafe<{ sessions: Array<{ id: string; workspaceId: string }> }>(importedIndexPath)
    const currentIndexPath = getAgentSessionsIndexPath()
    const current = readJsonSafe<{ version: number; sessions: Array<Record<string, unknown>> }>(currentIndexPath) ?? { version: 1, sessions: [] }
    const currentIds = new Set(current.sessions.map((s) => s['id']))

    for (const s of imported?.sessions ?? []) {
      if (!currentIds.has(s.id)) {
        current.sessions.push({ ...s, workspaceId: targetWorkspace.id })
      }
    }
    writeFileSync(currentIndexPath, JSON.stringify(current, null, 2), 'utf-8')
  }

  // 会话工作目录
  const workspaceDataDir = join(tempDir, 'sessions/workspace-data')
  if (existsSync(workspaceDataDir)) {
    for (const sessionId of readdirSync(workspaceDataDir)) {
      const src = join(workspaceDataDir, sessionId)
      const dest = getAgentSessionWorkspacePath(targetWorkspace.slug, sessionId)
      if (!existsSync(dest)) {
        cpSync(src, dest, { recursive: true })
      }
    }
  }

  // Chat 对话
  const chatDir = join(tempDir, 'sessions/chat')
  const convDir = getConversationsDir()
  if (existsSync(chatDir)) {
    for (const file of readdirSync(chatDir)) {
      if (!file.endsWith('.jsonl')) continue
      const src = join(chatDir, file)
      const dest = join(convDir, file)
      if (!existsSync(dest)) {
        cpSync(src, dest)
      }
    }
  }

  // Chat 对话 index 合并
  const importedConvIndexPath = join(tempDir, 'sessions/conversations-index.json')
  if (existsSync(importedConvIndexPath)) {
    const imported = readJsonSafe<{ conversations: Array<{ id: string }> }>(importedConvIndexPath)
    const currentIndexPath = getConversationsIndexPath()
    const current = readJsonSafe<{ version: number; conversations: Array<{ id: string }> }>(currentIndexPath) ?? { version: 1, conversations: [] }
    const currentIds = new Set(current.conversations.map((c) => c.id))

    for (const c of imported?.conversations ?? []) {
      if (!currentIds.has(c.id)) {
        current.conversations.push(c)
      }
    }
    writeFileSync(currentIndexPath, JSON.stringify(current, null, 2), 'utf-8')
  }
}

function _importSkills(tempDir: string, targetWorkspace: AgentWorkspace, overwrite = false) {
  const activeDir = join(tempDir, 'skills/active')
  if (existsSync(activeDir)) {
    const targetSkillsDir = getWorkspaceSkillsDir(targetWorkspace.slug)
    for (const skillName of readdirSync(activeDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
      const src = join(activeDir, skillName)
      const dest = join(targetSkillsDir, skillName)
      if (existsSync(dest)) {
        if (!overwrite) continue
        rmSync(dest, { recursive: true, force: true })
      }
      cpSync(src, dest, { recursive: true })
    }
  }
}

function _importMcp(tempDir: string, targetWorkspace: AgentWorkspace, overwrite = false) {
  const srcMcp = join(tempDir, 'config/mcp.json')
  if (!existsSync(srcMcp)) return
  const destMcp = getWorkspaceMcpPath(targetWorkspace.slug)
  if (existsSync(destMcp)) {
    const existing = readJsonSafe<{ servers?: Record<string, unknown> }>(destMcp) ?? {}
    const imported = readJsonSafe<{ servers?: Record<string, unknown> }>(srcMcp) ?? {}
    const merged = overwrite
      ? { ...existing, servers: { ...existing.servers, ...imported.servers } }
      : { ...existing, servers: { ...imported.servers, ...existing.servers } }
    writeFileSync(destMcp, JSON.stringify(merged, null, 2), 'utf-8')
  } else {
    mkdirSync(getAgentWorkspacePath(targetWorkspace.slug), { recursive: true })
    cpSync(srcMcp, destMcp)
  }
}

function _importChannels(tempDir: string, mode: MigrationMode) {
  const srcChannels = join(tempDir, 'config/channels.json')
  if (!existsSync(srcChannels)) return

  const imported = readJsonSafe<{ version: number; channels: Array<Record<string, unknown>> }>(srcChannels)
  if (!imported) return

  const currentPath = getChannelsPath()
  const current = readJsonSafe<{ version: number; channels: Array<Record<string, unknown>> }>(currentPath) ?? { version: 1, channels: [] }
  const currentIds = new Set(current.channels.map((c) => c['id']))

  for (const ch of imported.channels) {
    if (currentIds.has(ch['id'])) continue
    if (mode === 'personal' && ch['apiKey']) {
      let encryptedKey = ''
      try {
        if (safeStorage.isEncryptionAvailable()) {
          encryptedKey = safeStorage.encryptString(ch['apiKey'] as string).toString('base64')
        } else {
          encryptedKey = ch['apiKey'] as string
        }
      } catch {
        encryptedKey = ''
      }
      current.channels.push({ ...ch, apiKey: encryptedKey })
    } else {
      current.channels.push({ ...ch, apiKey: '' })
    }
  }

  writeFileSync(currentPath, JSON.stringify(current, null, 2), 'utf-8')
}

function _importChatTools(tempDir: string) {
  const srcTools = join(tempDir, 'config/chat-tools.json')
  if (!existsSync(srcTools)) return

  const imported = readJsonSafe<{ toolStates?: Record<string, unknown>; toolCredentials?: Record<string, unknown>; customTools?: unknown[] }>(srcTools)
  if (!imported) return

  const currentPath = getChatToolsConfigPath()
  if (!existsSync(currentPath)) {
    cpSync(srcTools, currentPath)
    return
  }

  const current = readJsonSafe<{ toolStates?: Record<string, unknown>; toolCredentials?: Record<string, unknown>; customTools?: unknown[] }>(currentPath) ?? {}
  // 合并 toolStates（不覆盖已有）
  const merged = {
    ...current,
    toolStates: { ...imported.toolStates, ...current.toolStates },
    customTools: [...(current.customTools ?? []), ...(imported.customTools ?? [])],
  }
  writeFileSync(currentPath, JSON.stringify(merged, null, 2), 'utf-8')
}

function _importWorkspaceConfig(tempDir: string, targetWorkspace: AgentWorkspace, pathMappings: Record<string, string | null>) {
  const srcConfig = join(tempDir, 'config/workspace-config.json')
  if (!existsSync(srcConfig)) return

  const config = readJsonSafe<{ attachedDirectories?: string[] }>(srcConfig)
  if (!config?.attachedDirectories) return

  // 应用路径映射
  const newDirs: string[] = []
  for (const dir of config.attachedDirectories) {
    const mapped = pathMappings[dir]
    if (mapped === null) continue // 用户选择移除
    if (mapped !== undefined) {
      newDirs.push(mapped) // 用户重新映射
    } else if (existsSync(dir)) {
      newDirs.push(dir) // 路径存在，直接保留
    }
    // 路径不存在且无映射：跳过（移除）
  }

  // 写入目标工作区 config
  const destConfigPath = join(getAgentWorkspacePath(targetWorkspace.slug), 'config.json')
  const existingConfig = existsSync(destConfigPath)
    ? readJsonSafe<{ attachedDirectories?: string[] }>(destConfigPath) ?? {}
    : {}
  const merged = { ...existingConfig, attachedDirectories: [...new Set([...(existingConfig.attachedDirectories ?? []), ...newDirs])] }
  writeFileSync(destConfigPath, JSON.stringify(merged, null, 2), 'utf-8')
}

function _importPersonalFiles(tempDir: string) {
  const files: Array<[string, string]> = [
    [join(tempDir, 'auth/settings.json'), getSettingsPath()],
    [join(tempDir, 'auth/user-profile.json'), getUserProfilePath()],
    [join(tempDir, 'auth/cloud-auth.json'), join(getConfigDir(), 'cloud-auth.json')],
  ]
  for (const [src, dest] of files) {
    if (existsSync(src)) {
      if (existsSync(dest)) {
        const backupPath = `${dest}.backup-${Date.now()}`
        cpSync(dest, backupPath)
      }
      cpSync(src, dest)
    }
  }
}

// ─── v2 导入辅助函数 ─────────────────────────────────────────────────────────

function _importSkillsV2(tempDir: string, sourceSlug: string, targetWorkspace: AgentWorkspace, overwrite = false) {
  const activeDir = join(tempDir, `workspaces/${sourceSlug}/skills/active`)
  if (existsSync(activeDir)) {
    const targetSkillsDir = getWorkspaceSkillsDir(targetWorkspace.slug)
    for (const entry of readdirSync(activeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dest = join(targetSkillsDir, entry.name)
      if (existsSync(dest)) {
        if (!overwrite) continue
        rmSync(dest, { recursive: true, force: true })
      }
      cpSync(join(activeDir, entry.name), dest, { recursive: true })
    }
  }

  const inactiveDir = join(tempDir, `workspaces/${sourceSlug}/skills/inactive`)
  if (existsSync(inactiveDir)) {
    const targetInactiveDir = getInactiveSkillsDir(targetWorkspace.slug)
    for (const entry of readdirSync(inactiveDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dest = join(targetInactiveDir, entry.name)
      if (existsSync(dest)) {
        if (!overwrite) continue
        rmSync(dest, { recursive: true, force: true })
      }
      cpSync(join(inactiveDir, entry.name), dest, { recursive: true })
    }
  }
}

function _importMcpV2(tempDir: string, sourceSlug: string, targetWorkspace: AgentWorkspace, overwrite = false) {
  const srcMcp = join(tempDir, `workspaces/${sourceSlug}/config/mcp.json`)
  if (!existsSync(srcMcp)) return

  const destMcp = getWorkspaceMcpPath(targetWorkspace.slug)
  if (existsSync(destMcp)) {
    const existing = readJsonSafe<{ servers?: Record<string, unknown> }>(destMcp) ?? {}
    const imported = readJsonSafe<{ servers?: Record<string, unknown> }>(srcMcp) ?? {}
    const merged = overwrite
      ? { ...existing, servers: { ...existing.servers, ...imported.servers } }
      : { ...existing, servers: { ...imported.servers, ...existing.servers } }
    writeFileSync(destMcp, JSON.stringify(merged, null, 2), 'utf-8')
  } else {
    mkdirSync(getAgentWorkspacePath(targetWorkspace.slug), { recursive: true })
    cpSync(srcMcp, destMcp)
  }
}

function _importWorkspaceConfigV2(
  tempDir: string,
  sourceSlug: string,
  targetWorkspace: AgentWorkspace,
  pathMappings: Record<string, string | null>,
) {
  const srcConfig = join(tempDir, `workspaces/${sourceSlug}/config/workspace-config.json`)
  if (!existsSync(srcConfig)) return

  const config = readJsonSafe<{ attachedDirectories?: string[] }>(srcConfig)
  if (!config?.attachedDirectories) return

  const newDirs: string[] = []
  for (const dir of config.attachedDirectories) {
    const mapped = pathMappings[dir]
    if (mapped === null) continue
    if (mapped !== undefined) {
      newDirs.push(mapped)
    } else if (existsSync(dir)) {
      newDirs.push(dir)
    }
  }

  const destConfigPath = join(getAgentWorkspacePath(targetWorkspace.slug), 'config.json')
  const existingConfig = existsSync(destConfigPath)
    ? readJsonSafe<{ attachedDirectories?: string[] }>(destConfigPath) ?? {}
    : {}
  const merged = { ...existingConfig, attachedDirectories: [...new Set([...(existingConfig.attachedDirectories ?? []), ...newDirs])] }
  writeFileSync(destConfigPath, JSON.stringify(merged, null, 2), 'utf-8')
}

async function _importSessionsV2(
  tempDir: string,
  wsIdMap: Map<string, AgentWorkspace>,
  fallbackWorkspace: AgentWorkspace,
) {
  const agentDir = join(tempDir, 'sessions/agent')
  const agentSessionsDir = getAgentSessionsDir()
  if (existsSync(agentDir)) {
    for (const file of readdirSync(agentDir)) {
      if (!file.endsWith('.jsonl')) continue
      const dest = join(agentSessionsDir, file)
      if (!existsSync(dest)) {
        cpSync(join(agentDir, file), dest)
      }
    }
  }

  const importedIndexPath = join(tempDir, 'sessions/agent-sessions-index.json')
  if (existsSync(importedIndexPath)) {
    const imported = readJsonSafe<{ sessions: Array<{ id: string; workspaceId: string }> }>(importedIndexPath)
    const currentIndexPath = getAgentSessionsIndexPath()
    const current = readJsonSafe<{ version: number; sessions: Array<Record<string, unknown>> }>(currentIndexPath) ?? { version: 1, sessions: [] }
    const currentIds = new Set(current.sessions.map((s) => s['id']))

    for (const s of imported?.sessions ?? []) {
      if (currentIds.has(s.id)) continue
      const target = wsIdMap.get(s.workspaceId) ?? fallbackWorkspace
      current.sessions.push({ ...s, workspaceId: target.id })
    }
    writeFileSync(currentIndexPath, JSON.stringify(current, null, 2), 'utf-8')
  }

  const workspaceDataDir = join(tempDir, 'sessions/workspace-data')
  if (existsSync(workspaceDataDir)) {
    for (const sessionId of readdirSync(workspaceDataDir)) {
      const src = join(workspaceDataDir, sessionId)
      const dest = getAgentSessionWorkspacePath(fallbackWorkspace.slug, sessionId)
      if (!existsSync(dest)) {
        cpSync(src, dest, { recursive: true })
      }
    }
  }

  const chatDir = join(tempDir, 'sessions/chat')
  const convDir = getConversationsDir()
  if (existsSync(chatDir)) {
    for (const file of readdirSync(chatDir)) {
      if (!file.endsWith('.jsonl')) continue
      const dest = join(convDir, file)
      if (!existsSync(dest)) {
        cpSync(join(chatDir, file), dest)
      }
    }
  }

  const importedConvIndexPath = join(tempDir, 'sessions/conversations-index.json')
  if (existsSync(importedConvIndexPath)) {
    const imported = readJsonSafe<{ conversations: Array<{ id: string }> }>(importedConvIndexPath)
    const currentIndexPath = getConversationsIndexPath()
    const current = readJsonSafe<{ version: number; conversations: Array<{ id: string }> }>(currentIndexPath) ?? { version: 1, conversations: [] }
    const currentIds = new Set(current.conversations.map((c) => c.id))

    for (const c of imported?.conversations ?? []) {
      if (!currentIds.has(c.id)) {
        current.conversations.push(c)
      }
    }
    writeFileSync(currentIndexPath, JSON.stringify(current, null, 2), 'utf-8')
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function readJsonSafe<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function buildExportResult(filePath: string, warnings: string[]): ExportResult {
  if (warnings.length === 0) return { success: true, filePath }
  return { success: true, filePath, warnings }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function addExportWarning(warnings: string[], message: string): void {
  warnings.push(message)
  console.warn(`[数据迁移] ${message}`)
}

/** 递归将本地目录的所有文件加入 zip 指定前缀路径 */
function _addDirToZip(zip: AdmZip, srcDir: string, zipPrefix: string, warnings: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(srcDir, { withFileTypes: true })
  } catch (error) {
    addExportWarning(warnings, `已跳过无法读取的目录: ${srcDir} (${formatErrorMessage(error)})`)
    return
  }

  for (const entry of entries) {
    const fullPath = join(srcDir, entry.name)
    const entryZipPath = `${zipPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      _addDirToZip(zip, fullPath, entryZipPath, warnings)
    } else {
      try {
        zip.addLocalFile(fullPath, zipPrefix)
      } catch (error) {
        addExportWarning(warnings, `已跳过无法读取的备份项目: ${fullPath} (${formatErrorMessage(error)})`)
      }
    }
  }
}

/** Zip Slip 安全解压：校验每个条目的路径不会逃逸 targetDir */
function _safeExtractAll(zip: AdmZip, targetDir: string): void {
  const resolvedTarget = resolve(targetDir)
  for (const entry of zip.getEntries()) {
    const entryPath = resolve(targetDir, entry.entryName)
    if (!entryPath.startsWith(resolvedTarget + '/') && entryPath !== resolvedTarget) {
      throw new Error(`迁移文件包含非法路径，已拒绝解压: ${entry.entryName}`)
    }
  }
  zip.extractAllTo(targetDir, true)
}
