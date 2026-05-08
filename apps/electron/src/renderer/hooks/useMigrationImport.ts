import { useState, useEffect, useCallback } from 'react'

type MigrationComponent = 'sessions' | 'skills' | 'mcp' | 'channels' | 'chattools'

interface PathCheckResult {
  path: string
  exists: boolean
  suggested?: string
}

export interface ImportPreview {
  manifest: {
    mode: string
    version?: string
    workspaceName?: string
    sourcePlatform: string
    exportedAt: number
    components: MigrationComponent[]
    workspaces?: Array<{
      workspaceSlug: string
      workspaceName: string
    }>
  }
  agentSessionCount: number
  chatConversationCount: number
  skillNames: string[]
  hasMcp: boolean
  crossPlatform: boolean
  pathCheckResults: PathCheckResult[]
  tempDir: string
  workspaces?: WorkspaceImportPreviewItem[]
}

export interface WorkspaceImportPreviewItem {
  workspaceSlug: string
  workspaceName: string
  skillNames: string[]
  mcpServerNames: string[]
  existsLocally: boolean
  localWorkspaceId?: string
}

export interface WorkspaceImportMapping {
  sourceSlug: string
  action: 'merge' | 'create' | 'skip'
  targetWorkspaceId?: string
  newWorkspaceName?: string
}

interface UseMigrationImportReturn {
  importing: boolean
  importPreview: ImportPreview | null
  pathMappings: Record<string, string | null>
  workspaceMappings: WorkspaceImportMapping[]
  importConfirming: boolean
  importResult: { success: boolean; error?: string } | null
  isV2: boolean
  handleSelectImportFile: () => Promise<void>
  handleConfirmImport: () => Promise<void>
  handlePathMapping: (originalPath: string, newValue: string | null) => void
  handleWorkspaceMapping: (sourceSlug: string, mapping: Partial<WorkspaceImportMapping>) => void
  reset: () => void
}

export function useMigrationImport(initialFilePath?: string | null): UseMigrationImportReturn {
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [pathMappings, setPathMappings] = useState<Record<string, string | null>>({})
  const [workspaceMappings, setWorkspaceMappings] = useState<WorkspaceImportMapping[]>([])
  const [importConfirming, setImportConfirming] = useState(false)
  const [importResult, setImportResult] = useState<{ success: boolean; error?: string } | null>(null)

  const isV2 = importPreview?.manifest.version === '2.0' && !!importPreview.workspaces

  const initFromPreview = useCallback((preview: ImportPreview) => {
    const initialPathMappings: Record<string, string | null> = {}
    for (const r of preview.pathCheckResults) {
      if (!r.exists) initialPathMappings[r.path] = null
    }
    setPathMappings(initialPathMappings)

    if (preview.manifest.version === '2.0' && preview.workspaces) {
      const mappings: WorkspaceImportMapping[] = preview.workspaces.map((ws) => ({
        sourceSlug: ws.workspaceSlug,
        action: ws.existsLocally ? 'merge' : 'create',
        targetWorkspaceId: ws.localWorkspaceId,
        newWorkspaceName: ws.workspaceName,
      }))
      setWorkspaceMappings(mappings)
    } else {
      setWorkspaceMappings([])
    }

    setImportPreview(preview)
  }, [])

  const parseFile = useCallback(async (filePath: string) => {
    setImporting(true)
    setImportPreview(null)
    setImportResult(null)

    try {
      const preview = await window.electronAPI.migrationParseImportFile(filePath) as ImportPreview
      initFromPreview(preview)
    } catch (err) {
      setImportResult({ success: false, error: err instanceof Error ? err.message : '解析文件失败' })
    } finally {
      setImporting(false)
    }
  }, [initFromPreview])

  useEffect(() => {
    if (initialFilePath) {
      parseFile(initialFilePath)
    }
  }, [initialFilePath, parseFile])

  const handleSelectImportFile = useCallback(async () => {
    setImporting(true)
    setImportPreview(null)
    setImportResult(null)

    try {
      const filePath = await window.electronAPI.migrationOpenFileDialog()
      if (!filePath) {
        setImporting(false)
        return
      }
      const preview = await window.electronAPI.migrationParseImportFile(filePath) as ImportPreview
      initFromPreview(preview)
    } catch (err) {
      setImportResult({ success: false, error: err instanceof Error ? err.message : '解析文件失败' })
    } finally {
      setImporting(false)
    }
  }, [initFromPreview])

  const handleConfirmImport = useCallback(async () => {
    if (!importPreview) return
    setImportConfirming(true)

    try {
      await window.electronAPI.migrationConfirmImport({
        tempDir: importPreview.tempDir,
        manifest: importPreview.manifest,
        pathMappings,
        ...(isV2 ? { workspaceMappings } : {}),
      })
      setImportResult({ success: true })
      setImportPreview(null)
    } catch (err) {
      setImportResult({ success: false, error: err instanceof Error ? err.message : '导入失败' })
    } finally {
      setImportConfirming(false)
    }
  }, [importPreview, pathMappings, workspaceMappings, isV2])

  const handlePathMapping = useCallback((originalPath: string, newValue: string | null) => {
    setPathMappings((prev) => ({ ...prev, [originalPath]: newValue }))
  }, [])

  const handleWorkspaceMapping = useCallback((sourceSlug: string, partial: Partial<WorkspaceImportMapping>) => {
    setWorkspaceMappings((prev) =>
      prev.map((m) => (m.sourceSlug === sourceSlug ? { ...m, ...partial } : m))
    )
  }, [])

  const reset = useCallback(() => {
    setImporting(false)
    setImportPreview(null)
    setPathMappings({})
    setWorkspaceMappings([])
    setImportConfirming(false)
    setImportResult(null)
  }, [])

  return {
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
  }
}
