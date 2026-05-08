import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderOpen,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  migrationImportDialogOpenAtom,
  migrationImportInitialFilePathAtom,
} from '@/atoms/migration-atoms'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { useMigrationImport } from '@/hooks/useMigrationImport'
import type { WorkspaceImportPreviewItem } from '@/hooks/useMigrationImport'

export function MigrationImportDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(migrationImportDialogOpenAtom)
  const [initialFilePath, setInitialFilePath] = useAtom(migrationImportInitialFilePathAtom)
  const localWorkspaces = useAtomValue(agentWorkspacesAtom)

  const {
    importing,
    importPreview,
    pathMappings,
    workspaceMappings,
    importConfirming,
    importResult,
    isV2,
    handleSelectImportFile,
    handleConfirmImport,
    handlePathMapping,
    handleWorkspaceMapping,
    reset,
  } = useMigrationImport(open ? initialFilePath : null)

  React.useEffect(() => {
    const unsub = window.electronAPI.onMigrationOpenImportFile(({ filePath }) => {
      setInitialFilePath(filePath)
      setOpen(true)
    })
    return unsub
  }, [setInitialFilePath, setOpen])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset()
      setInitialFilePath(null)
    }
    setOpen(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导入配置</DialogTitle>
          <DialogDescription>
            从备份文件导入数据，支持 .proma-backup 和 .proma-share 格式
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* 阶段 1：选择文件 */}
          {!importPreview && !importResult?.success && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                <FolderOpen size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                选择 .proma-backup 或 .proma-share 文件开始导入
              </p>
              <button
                onClick={handleSelectImportFile}
                disabled={importing}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                {importing ? '解析中...' : '选择文件'}
              </button>

              {importResult && !importResult.success && (
                <div className="flex items-center gap-1.5 text-sm text-red-500">
                  <XCircle size={15} />
                  {importResult.error}
                </div>
              )}
            </div>
          )}

          {/* 阶段 2：预览 & 配置 */}
          {importPreview && (
            <div className="space-y-4">
              {/* 跨平台警告 */}
              {importPreview.crossPlatform && (
                <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 dark:bg-amber-950/20 dark:border-amber-800">
                  <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-700 dark:text-amber-400">
                    <p className="font-medium">检测到跨平台迁移（{importPreview.manifest.sourcePlatform} → 当前系统）</p>
                    <p className="mt-0.5 text-amber-600 dark:text-amber-500">部分 Skills 和 MCP 工具可能需要手动调整命令路径。</p>
                  </div>
                </div>
              )}

              {/* 内容摘要 */}
              {isV2 && importPreview.workspaces ? (
                <V2ContentSummary
                  preview={importPreview}
                  workspaceMappings={workspaceMappings}
                  localWorkspaces={localWorkspaces}
                  onWorkspaceMapping={handleWorkspaceMapping}
                />
              ) : (
                <V1ContentSummary preview={importPreview} />
              )}

              {/* 路径检查 */}
              {importPreview.pathCheckResults.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">附加目录处理</label>
                  <div className="rounded-lg border border-border/50 divide-y divide-border/30">
                    {importPreview.pathCheckResults.map((r) => (
                      <div key={r.path} className="px-4 py-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          {r.exists ? (
                            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                          ) : (
                            <XCircle size={14} className="text-red-400 flex-shrink-0" />
                          )}
                          <span className="text-xs font-mono text-foreground truncate">{r.path}</span>
                        </div>
                        {!r.exists && (
                          <div className="flex items-center gap-2 pl-5">
                            <span className="text-xs text-muted-foreground">处理方式：</span>
                            <select
                              value={pathMappings[r.path] === null ? '__remove' : (pathMappings[r.path] ?? '__remove')}
                              onChange={(e) => handlePathMapping(r.path, e.target.value === '__remove' ? null : e.target.value)}
                              className="text-xs border border-border rounded px-2 py-1 bg-background"
                            >
                              <option value="__remove">移除（推荐）</option>
                              {r.suggested && (
                                <option value={r.suggested}>推断路径：{r.suggested}</option>
                              )}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 确认 / 取消 */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleConfirmImport}
                  disabled={importConfirming}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                    'bg-primary text-primary-foreground hover:bg-primary/90',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {importConfirming ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  {importConfirming ? '导入中...' : '确认导入'}
                </button>
                <button
                  onClick={() => {
                    reset()
                    setInitialFilePath(null)
                  }}
                  disabled={importConfirming}
                  className="px-4 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  取消
                </button>
              </div>

              {importResult && !importResult.success && (
                <div className="flex items-center gap-1.5 text-sm text-red-500">
                  <XCircle size={15} />
                  {importResult.error}
                </div>
              )}
            </div>
          )}

          {/* 阶段 3：导入成功 */}
          {importResult?.success && !importPreview && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">导入成功</p>
                <p className="text-xs text-muted-foreground mt-1">请重启应用使所有更改生效</p>
              </div>
              <button
                onClick={() => handleOpenChange(false)}
                className={cn(
                  'px-5 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                关闭
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── v1 内容摘要（原有逻辑）────────────────────────────────────────────────

function V1ContentSummary({ preview }: { preview: { manifest: { workspaceName?: string; exportedAt: number; components: string[] }; agentSessionCount: number; chatConversationCount: number; skillNames: string[]; hasMcp: boolean } }): React.ReactElement {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 space-y-2">
      <p className="text-sm font-medium text-foreground">
        包内容来自：{preview.manifest.workspaceName ?? '未知工作区'}（
        {new Date(preview.manifest.exportedAt).toLocaleDateString('zh-CN')}）
      </p>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-muted-foreground">
        {preview.agentSessionCount > 0 && (
          <span>Agent 会话：{preview.agentSessionCount} 个</span>
        )}
        {preview.chatConversationCount > 0 && (
          <span>Chat 对话：{preview.chatConversationCount} 个</span>
        )}
        {preview.skillNames.length > 0 && (
          <span>Skills：{preview.skillNames.length} 个</span>
        )}
        {preview.hasMcp && <span>MCP 配置：已包含</span>}
        {preview.manifest.components.includes('channels') && (
          <span>模型渠道：已包含</span>
        )}
        {preview.manifest.components.includes('chattools') && (
          <span>Chat 工具：已包含</span>
        )}
      </div>
    </div>
  )
}

// ─── v2 多工作区内容摘要 ──────────────────────────────────────────────────

interface V2ContentSummaryProps {
  preview: { manifest: { exportedAt: number; components: string[] }; agentSessionCount: number; chatConversationCount: number; workspaces?: WorkspaceImportPreviewItem[] }
  workspaceMappings: Array<{ sourceSlug: string; action: string; targetWorkspaceId?: string; newWorkspaceName?: string }>
  localWorkspaces: Array<{ id: string; name: string; slug: string }>
  onWorkspaceMapping: (sourceSlug: string, mapping: Record<string, unknown>) => void
}

function V2ContentSummary({ preview, workspaceMappings, localWorkspaces, onWorkspaceMapping }: V2ContentSummaryProps): React.ReactElement {
  const wsCount = preview.workspaces?.length ?? 0

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 space-y-2">
        <p className="text-sm font-medium text-foreground">
          包含 {wsCount} 个工作区的配置（导出于 {new Date(preview.manifest.exportedAt).toLocaleDateString('zh-CN')}）
        </p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-muted-foreground">
          {preview.agentSessionCount > 0 && (
            <span>Agent 会话：{preview.agentSessionCount} 个</span>
          )}
          {preview.chatConversationCount > 0 && (
            <span>Chat 对话：{preview.chatConversationCount} 个</span>
          )}
          {preview.manifest.components.includes('channels') && (
            <span>模型渠道：已包含</span>
          )}
          {preview.manifest.components.includes('chattools') && (
            <span>Chat 工具：已包含</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">工作区导入方式</label>
        <div className="rounded-lg border border-border/50 divide-y divide-border/30">
          {(preview.workspaces ?? []).map((ws) => {
            const mapping = workspaceMappings.find((m) => m.sourceSlug === ws.workspaceSlug)
            const action = mapping?.action ?? 'merge'

            return (
              <div key={ws.workspaceSlug} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  {ws.existsLocally ? (
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-foreground">{ws.workspaceName}</span>
                  <span className="text-xs text-muted-foreground font-mono">{ws.workspaceSlug}</span>
                </div>
                <div className="flex items-center gap-4 pl-5 text-xs text-muted-foreground">
                  {ws.skillNames.length > 0 && <span>Skills: {ws.skillNames.length} 个</span>}
                  {ws.mcpServerNames.length > 0 && <span>MCP: {ws.mcpServerNames.length} 个</span>}
                </div>
                <div className="flex items-center gap-2 pl-5">
                  <span className="text-xs text-muted-foreground">操作：</span>
                  <select
                    value={action}
                    onChange={(e) => {
                      const newAction = e.target.value as 'merge' | 'create' | 'skip'
                      if (newAction === 'merge' && ws.existsLocally) {
                        onWorkspaceMapping(ws.workspaceSlug, { action: 'merge', targetWorkspaceId: ws.localWorkspaceId })
                      } else if (newAction === 'merge') {
                        onWorkspaceMapping(ws.workspaceSlug, { action: 'merge', targetWorkspaceId: localWorkspaces[0]?.id })
                      } else if (newAction === 'create') {
                        onWorkspaceMapping(ws.workspaceSlug, { action: 'create', newWorkspaceName: ws.workspaceName })
                      } else {
                        onWorkspaceMapping(ws.workspaceSlug, { action: 'skip' })
                      }
                    }}
                    className="text-xs border border-border rounded px-2 py-1 bg-background"
                  >
                    {ws.existsLocally && (
                      <option value="merge">合并到已有工作区</option>
                    )}
                    {!ws.existsLocally && localWorkspaces.length > 0 && (
                      <option value="merge">合并到现有工作区...</option>
                    )}
                    <option value="create">创建新工作区</option>
                    <option value="skip">跳过</option>
                  </select>

                  {action === 'merge' && !ws.existsLocally && (
                    <select
                      value={mapping?.targetWorkspaceId ?? ''}
                      onChange={(e) => onWorkspaceMapping(ws.workspaceSlug, { action: 'merge', targetWorkspaceId: e.target.value })}
                      className="text-xs border border-border rounded px-2 py-1 bg-background"
                    >
                      <option value="">选择工作区...</option>
                      {localWorkspaces.map((lw) => (
                        <option key={lw.id} value={lw.id}>{lw.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
