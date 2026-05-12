/**
 * MigrationSettings - 数据迁移设置页
 *
 * 支持两种模式：
 * - Personal 备份（.proma-backup）：全量导出，含解密 API Key
 * - Share 分发（.proma-share）：自由选择组件，凭据自动剥离
 *
 * Share 模式支持多工作区导出：
 * - 默认：导出所有工作区的 Skills + MCP
 * - 自定义：按工作区逐个选择 Skills 和 MCP servers
 */

import * as React from 'react'
import {
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { SettingsSection } from './primitives'
import { useAtomValue, useSetAtom } from 'jotai'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { migrationImportDialogOpenAtom } from '@/atoms/migration-atoms'
import { cn } from '@/lib/utils'

type MigrationMode = 'personal' | 'share'
type MigrationComponent = 'sessions' | 'skills' | 'mcp' | 'channels' | 'chattools'
type ShareDetailMode = 'default' | 'custom'

interface ShareExportWorkspacePreview {
  workspace: { id: string; name: string; slug: string }
  skills: Array<{ slug: string; name: string; enabled: boolean }>
  mcpServers: Array<{ name: string; enabled: boolean; type: string }>
}

interface ShareExportPreview {
  workspaces: ShareExportWorkspacePreview[]
  agentSessionCount: number
  chatConversationCount: number
}

interface WsSelection {
  skills: Set<string>
  mcpServers: Set<string>
}

interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
  warnings?: string[]
}

const COMPONENT_LABELS: Record<MigrationComponent, string> = {
  sessions: '会话记录',
  skills: 'Skills',
  mcp: 'MCP 配置',
  channels: '模型渠道',
  chattools: 'Chat 工具',
}

export function MigrationSettings(): React.ReactElement {
  // ── 导出状态 ──────────────────────────────────────
  const [exportMode, setExportMode] = React.useState<MigrationMode>('personal')
  const [shareComponents, setShareComponents] = React.useState<Set<MigrationComponent>>(
    new Set(['sessions', 'skills', 'mcp'])
  )
  const [exporting, setExporting] = React.useState(false)
  const [exportResult, setExportResult] = React.useState<ExportResult | null>(null)

  // ── 多工作区选择状态 ──────────────────────────────
  const [shareDetailMode, setShareDetailMode] = React.useState<ShareDetailMode>('default')
  const [sharePreview, setSharePreview] = React.useState<ShareExportPreview | null>(null)
  const [sharePreviewLoading, setSharePreviewLoading] = React.useState(false)
  const [wsSelections, setWsSelections] = React.useState<Map<string, WsSelection>>(new Map())
  const [expandedWorkspaces, setExpandedWorkspaces] = React.useState<Set<string>>(new Set())

  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspace = workspaces[0]
  const setMigrationImportDialogOpen = useSetAtom(migrationImportDialogOpenAtom)

  const hasSkillsOrMcp = shareComponents.has('skills') || shareComponents.has('mcp')

  // ── 加载多工作区预览 ──────────────────────────────
  const loadSharePreview = React.useCallback(async () => {
    setSharePreviewLoading(true)
    try {
      const preview = await window.electronAPI.migrationGetShareExportPreview() as ShareExportPreview
      setSharePreview(preview)
      const selections = new Map<string, WsSelection>()
      for (const ws of preview.workspaces) {
        selections.set(ws.workspace.id, {
          skills: new Set(ws.skills.map((s) => s.slug)),
          mcpServers: new Set(ws.mcpServers.map((m) => m.name)),
        })
      }
      setWsSelections(selections)
    } catch {
      // 静默失败
    } finally {
      setSharePreviewLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (exportMode === 'share' && shareDetailMode === 'custom' && !sharePreview) {
      loadSharePreview()
    }
  }, [exportMode, shareDetailMode, sharePreview, loadSharePreview])

  // ── 导出逻辑 ──────────────────────────────────────

  const handleExport = async (): Promise<void> => {
    if (!currentWorkspace) return
    setExporting(true)
    setExportResult(null)

    try {
      const outputPath = await window.electronAPI.migrationSaveFileDialog(exportMode)
      if (!outputPath) {
        setExporting(false)
        return
      }

      const components: MigrationComponent[] =
        exportMode === 'personal'
          ? ['sessions', 'skills', 'mcp', 'channels', 'chattools']
          : Array.from(shareComponents)

      if (exportMode === 'share') {
        let workspaceSelections: Array<{ workspaceId: string; skillSlugs?: string[]; mcpServerNames?: string[] }> | undefined

        if (shareDetailMode === 'custom' && sharePreview) {
          workspaceSelections = []
          for (const ws of sharePreview.workspaces) {
            const sel = wsSelections.get(ws.workspace.id)
            if (!sel) continue
            const hasSkills = sel.skills.size > 0 && shareComponents.has('skills')
            const hasMcp = sel.mcpServers.size > 0 && shareComponents.has('mcp')
            if (!hasSkills && !hasMcp) continue
            workspaceSelections.push({
              workspaceId: ws.workspace.id,
              skillSlugs: shareComponents.has('skills') ? Array.from(sel.skills) : undefined,
              mcpServerNames: shareComponents.has('mcp') ? Array.from(sel.mcpServers) : undefined,
            })
          }
        }

        const result = await window.electronAPI.migrationExportV2({
          mode: exportMode,
          components,
          outputPath,
          workspaceSelections,
        }) as { success: boolean; filePath: string; warnings?: string[] }
        setExportResult({ success: true, filePath: result.filePath, warnings: result.warnings })
      } else {
        // personal 模式：全量备份所有工作区
        const result = await window.electronAPI.migrationExportV2({
          mode: exportMode,
          components,
          outputPath,
        }) as { success: boolean; filePath: string; warnings?: string[] }
        setExportResult({ success: true, filePath: result.filePath, warnings: result.warnings })
      }
    } catch (err) {
      setExportResult({ success: false, error: err instanceof Error ? err.message : '导出失败' })
    } finally {
      setExporting(false)
    }
  }

  const toggleShareComponent = (comp: MigrationComponent): void => {
    setShareComponents((prev) => {
      const next = new Set(prev)
      if (next.has(comp)) next.delete(comp)
      else next.add(comp)
      return next
    })
  }

  const toggleWsExpand = (wsId: string): void => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      return next
    })
  }

  const toggleWsSkill = (wsId: string, slug: string): void => {
    setWsSelections((prev) => {
      const next = new Map(prev)
      const sel = { ...next.get(wsId)!, skills: new Set(next.get(wsId)!.skills), mcpServers: new Set(next.get(wsId)!.mcpServers) }
      if (sel.skills.has(slug)) sel.skills.delete(slug)
      else sel.skills.add(slug)
      next.set(wsId, sel)
      return next
    })
  }

  const toggleWsMcp = (wsId: string, name: string): void => {
    setWsSelections((prev) => {
      const next = new Map(prev)
      const sel = { ...next.get(wsId)!, skills: new Set(next.get(wsId)!.skills), mcpServers: new Set(next.get(wsId)!.mcpServers) }
      if (sel.mcpServers.has(name)) sel.mcpServers.delete(name)
      else sel.mcpServers.add(name)
      next.set(wsId, sel)
      return next
    })
  }

  const toggleWsAll = (wsId: string, wsPreview: ShareExportWorkspacePreview): void => {
    setWsSelections((prev) => {
      const next = new Map(prev)
      const sel = next.get(wsId)
      if (!sel) return prev
      const allSkills = wsPreview.skills.map((s) => s.slug)
      const allMcp = wsPreview.mcpServers.map((m) => m.name)
      const allSelected = allSkills.every((s) => sel.skills.has(s)) && allMcp.every((m) => sel.mcpServers.has(m))
      if (allSelected) {
        next.set(wsId, { skills: new Set(), mcpServers: new Set() })
      } else {
        next.set(wsId, { skills: new Set(allSkills), mcpServers: new Set(allMcp) })
      }
      return next
    })
  }

  return (
    <div className="space-y-8">
      {/* ── 导出区块 ──────────────────────────────── */}
      <SettingsSection
        title="导出备份"
        description="将当前工作区的数据导出为可移植的备份文件"
      >
        <div className="space-y-4">
          {/* 模式选择 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">导出模式</label>
            <div className="grid grid-cols-2 gap-3">
              <ModeCard
                active={exportMode === 'personal'}
                onClick={() => setExportMode('personal')}
                title="个人备份"
                subtitle=".proma-backup"
                description="完整备份所有数据，含 API Key，用于换机迁移"
              />
              <ModeCard
                active={exportMode === 'share'}
                onClick={() => setExportMode('share')}
                title="团队分发"
                subtitle=".proma-share"
                description="自选组件，凭据自动剥离，分享给同事"
              />
            </div>
          </div>

          {/* Share 模式组件选择 */}
          {exportMode === 'share' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">导出内容</label>
              <div className="rounded-lg border border-border/50 divide-y divide-border/30">
                {(Object.keys(COMPONENT_LABELS) as MigrationComponent[]).map((comp) => (
                  <label
                    key={comp}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={shareComponents.has(comp)}
                      onChange={() => toggleShareComponent(comp)}
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                    <span className="text-sm text-foreground">{COMPONENT_LABELS[comp]}</span>
                    {comp === 'channels' && (
                      <span className="text-xs text-muted-foreground ml-auto">API Key 将被剥离</span>
                    )}
                    {comp === 'mcp' && (
                      <span className="text-xs text-muted-foreground ml-auto">凭据将被剥离</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Share 模式：多工作区选择 */}
          {exportMode === 'share' && hasSkillsOrMcp && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">工作区范围</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShareDetailMode('default')}
                  className={cn(
                    'text-left px-3 py-2.5 rounded-lg border text-sm transition-colors',
                    shareDetailMode === 'default'
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/50 hover:border-border hover:bg-muted/30'
                  )}
                >
                  <span className="font-medium text-foreground">所有工作区</span>
                  <p className="text-xs text-muted-foreground mt-0.5">导出全部工作区的 Skills 和 MCP</p>
                </button>
                <button
                  onClick={() => setShareDetailMode('custom')}
                  className={cn(
                    'text-left px-3 py-2.5 rounded-lg border text-sm transition-colors',
                    shareDetailMode === 'custom'
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/50 hover:border-border hover:bg-muted/30'
                  )}
                >
                  <span className="font-medium text-foreground">自定义选择</span>
                  <p className="text-xs text-muted-foreground mt-0.5">手动挑选要导出的项目</p>
                </button>
              </div>

              {/* 自定义选择面板 */}
              {shareDetailMode === 'custom' && (
                <div className="rounded-lg border border-border/50">
                  {sharePreviewLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                      <Loader2 size={16} className="animate-spin" />
                      加载中...
                    </div>
                  ) : sharePreview ? (
                    <div className="divide-y divide-border/30">
                      {sharePreview.workspaces.map((ws) => {
                        const wsId = ws.workspace.id
                        const expanded = expandedWorkspaces.has(wsId)
                        const sel = wsSelections.get(wsId)
                        const totalItems = ws.skills.length + ws.mcpServers.length
                        const selectedItems = (sel?.skills.size ?? 0) + (sel?.mcpServers.size ?? 0)

                        return (
                          <div key={wsId}>
                            <div
                              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                              onClick={() => toggleWsExpand(wsId)}
                            >
                              {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                              <span className="text-sm font-medium text-foreground flex-1">{ws.workspace.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {selectedItems}/{totalItems} 项
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleWsAll(wsId, ws)
                                }}
                                className="text-xs text-primary hover:underline"
                              >
                                {selectedItems === totalItems ? '取消全选' : '全选'}
                              </button>
                            </div>

                            {expanded && (
                              <div className="px-4 pb-3 pl-9 space-y-1">
                                {shareComponents.has('skills') && ws.skills.length > 0 && (
                                  <>
                                    <p className="text-xs font-medium text-muted-foreground pt-1">Skills</p>
                                    {ws.skills.map((skill) => (
                                      <label key={skill.slug} className="flex items-center gap-2 py-0.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={sel?.skills.has(skill.slug) ?? false}
                                          onChange={() => toggleWsSkill(wsId, skill.slug)}
                                          className="w-3.5 h-3.5 rounded border-border accent-primary"
                                        />
                                        <span className="text-sm text-foreground">{skill.name}</span>
                                        {!skill.enabled && <span className="text-xs text-muted-foreground">(已禁用)</span>}
                                      </label>
                                    ))}
                                  </>
                                )}
                                {shareComponents.has('mcp') && ws.mcpServers.length > 0 && (
                                  <>
                                    <p className="text-xs font-medium text-muted-foreground pt-1">MCP Servers</p>
                                    {ws.mcpServers.map((server) => (
                                      <label key={server.name} className="flex items-center gap-2 py-0.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={sel?.mcpServers.has(server.name) ?? false}
                                          onChange={() => toggleWsMcp(wsId, server.name)}
                                          className="w-3.5 h-3.5 rounded border-border accent-primary"
                                        />
                                        <span className="text-sm text-foreground">{server.name}</span>
                                        <span className="text-xs text-muted-foreground">({server.type})</span>
                                      </label>
                                    ))}
                                  </>
                                )}
                                {((!shareComponents.has('skills') || ws.skills.length === 0) && (!shareComponents.has('mcp') || ws.mcpServers.length === 0)) && (
                                  <p className="text-xs text-muted-foreground py-1">此工作区没有可导出的项目</p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">加载预览失败</p>
                  )}
                </div>
              )}
            </div>
          )}

          {exportMode === 'personal' && (
            <div className="rounded-lg bg-muted/30 border border-border/30 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                将导出所有会话、Skills、MCP 配置、渠道（含 API Key）及个人设置。
                <br />
                请妥善保管备份文件，避免泄露其中的 API Key。
              </p>
            </div>
          )}

          {/* 导出按钮 */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={exporting || !currentWorkspace || (exportMode === 'share' && shareComponents.size === 0)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {exporting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              {exporting ? '导出中...' : '选择保存位置并导出'}
            </button>

            {exportResult && (
              <div className={cn('flex items-center gap-1.5 text-sm', exportResult.success ? 'text-green-600' : 'text-red-500')}>
                {exportResult.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                {exportResult.success
                  ? `已导出至 ${exportResult.filePath?.split('/').pop() ?? ''}`
                  : exportResult.error}
              </div>
            )}
          </div>

          {exportResult?.success && exportResult.warnings && exportResult.warnings.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0 space-y-1">
                <p>导出已完成，但有 {exportResult.warnings.length} 个项目无法读取，已跳过。</p>
                <p className="break-all text-xs opacity-90" title={exportResult.warnings.join('\n')}>
                  {exportResult.warnings[0]}
                  {exportResult.warnings.length > 1 ? ' 等' : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* ── 导入区块 ──────────────────────────────── */}
      <SettingsSection
        title="导入备份"
        description="从备份文件导入数据，支持 .proma-backup 和 .proma-share 格式"
      >
        <button
          onClick={() => setMigrationImportDialogOpen(true)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            'border border-border hover:bg-muted/50'
          )}
        >
          <Upload size={16} />
          打开导入
        </button>
      </SettingsSection>
    </div>
  )
}

// ─── 模式卡片子组件 ────────────────────────────────────────────────────────

interface ModeCardProps {
  active: boolean
  onClick: () => void
  title: string
  subtitle: string
  description: string
}

function ModeCard({ active, onClick, title, subtitle, description }: ModeCardProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-start gap-1 p-4 rounded-lg border text-left transition-colors',
        active
          ? 'border-primary/50 bg-primary/5'
          : 'border-border/50 hover:border-border hover:bg-muted/30'
      )}
    >
      {active && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary" />
      )}
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs font-mono text-muted-foreground">{subtitle}</span>
      <span className="text-xs text-muted-foreground leading-relaxed">{description}</span>
    </button>
  )
}
