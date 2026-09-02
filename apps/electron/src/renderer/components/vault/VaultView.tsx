import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { BookOpen, ChevronDown, ChevronRight, ChevronsUpDown, CircleHelp, Folder, FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { VaultCandidate, VaultFileEntry, VaultFocus, VaultReadResult, VaultSummary } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { VaultLiveMarkdownEditor } from './VaultLiveMarkdownEditor'
import { useVaultScrollMemory } from './useVaultScrollMemory'
import { getVaultScrollKey } from './vault-scroll-memory'
import type { LiveMarkdownEditorHandle, LiveMarkdownTextSelection } from '@/components/markdown/LiveMarkdownEditor'
import { SelectionActionPopover } from '@/components/selection/SelectionActionPopover'
import { focusChatInput } from '@/components/chat/focus-chat-input'
import { getOrCreateSideChat } from '@/lib/side-chat'
import { insertAgentInputQuote } from '@/lib/agent-input-quote'
import { useFocusAgentSessionInput } from '@/hooks/useFocusAgentSessionInput'
import {
  agentDiffPanelTabAtom,
  agentSidePanelOpenAtomFamily,
} from '@/atoms/agent-atoms'
import {
  agentSideChatMapAtom,
  conversationsAtom,
  conversationDraftsAtom,
  conversationQuotedSelectionMapAtom,
  selectedModelAtom,
} from '@/atoms/chat-atoms'
import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
import {
  focusedVaultFolderAtomFamily,
  getVaultSessionScope,
  selectedVaultFileAtomFamily,
  vaultReadResultAtomFamily,
  vaultRefreshTokenAtom,
} from '@/atoms/vault-atoms'
import { cn } from '@/lib/utils'
import { VaultContentErrorBoundary } from './VaultContentErrorBoundary'
import { getVaultEditorKey, shouldRemountVaultEditor } from './vault-editor-lifecycle'
import { getVaultDocumentController } from './vault-document-controller'
import { buildVaultTree, getInitialVaultExpandedFolders, getVaultFolderAncestors, hasSameVaultTreeEntries, type VaultFolderNode } from './vault-tree-model'

const VAULT_NAME = 'Vault'
const VAULT_SIDEBAR_MIN_WIDTH = 180
const VAULT_SIDEBAR_MAX_WIDTH = 520
const PROMA_MANAGED_VAULT_DISPLAY_NAME = 'Proma Vault'
const PROMA_SELF_MANAGED_VAULT_LABEL = 'Proma 自建 Vault'
const MAX_QUOTED_CHARS = 2000

interface VaultTextSelection extends LiveMarkdownTextSelection {
  text: string
}

function getVaultCandidateDisplayName(candidate: VaultCandidate): string {
  return candidate.isPromaManaged ? PROMA_MANAGED_VAULT_DISPLAY_NAME : candidate.displayName
}

function displayDocumentTitle(filename: string): string {
  return filename.replace(/\.md$/i, '')
}

function VaultFileList({
  files,
  selectedPath,
  focusedFolder,
  onSelect,
  onFocusFolder,
  onDelete,
  onCreateNote,
  onCreateFolder,
  canCreate,
  treeAction,
}: {
  files: VaultFileEntry[]
  selectedPath: string | null
  focusedFolder: string | null
  onSelect: (relativePath: string) => void
  onFocusFolder: (relativePath: string) => void
  onDelete: (file: VaultFileEntry) => void
  onCreateNote: (folderPath: string) => void
  onCreateFolder: (folderPath: string) => void
  canCreate: boolean
  treeAction: { type: 'expand' | 'collapse'; version: number }
}): React.ReactElement {
  const tree = React.useMemo(() => buildVaultTree(files), [files])
  const allFolderPaths = React.useMemo(() => {
    const paths: string[] = []
    const visit = (folder: VaultFolderNode): void => {
      for (const child of folder.folders.values()) {
        paths.push(child.relativePath)
        visit(child)
      }
    }
    visit(tree)
    return paths
  }, [tree])
  // Start collapsed: this prevents a large nested Vault from mounting every file
  // row and its Tooltip tree on first paint. Expanded paths survive list refreshes.
  const [expandedFolders, setExpandedFolders] = React.useState<ReadonlySet<string>>(getInitialVaultExpandedFolders)

  React.useEffect(() => {
    if (treeAction.version === 0) return
    setExpandedFolders(treeAction.type === 'expand' ? new Set(allFolderPaths) : new Set())
  }, [allFolderPaths, treeAction])

  React.useEffect(() => {
    if (!selectedPath) return
    const ancestors = getVaultFolderAncestors(selectedPath)
    if (ancestors.length === 0) return
    setExpandedFolders((current) => {
      const next = new Set(current)
      let changed = false
      for (const path of ancestors) {
        if (!next.has(path)) {
          next.add(path)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [selectedPath])

  React.useEffect(() => {
    if (!focusedFolder) return
    const paths = [...getVaultFolderAncestors(focusedFolder), focusedFolder]
    setExpandedFolders((current) => {
      const next = new Set(current)
      let changed = false
      for (const path of paths) {
        if (!next.has(path)) {
          next.add(path)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [focusedFolder])

  const renderEntries = (folder: VaultFolderNode, depth: number): React.ReactNode => (
    <>
      {Array.from(folder.folders.values())
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        .map((child) => {
          const expanded = expandedFolders.has(child.relativePath)
          const focused = focusedFolder === child.relativePath
          return (
            <React.Fragment key={child.relativePath}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? '收起' : '展开'}文件夹 ${child.name}`}
                    onClick={() => {
                      onFocusFolder(child.relativePath)
                      setExpandedFolders((current) => {
                        const next = new Set(current)
                        if (next.has(child.relativePath)) next.delete(child.relativePath)
                        else next.add(child.relativePath)
                        return next
                      })
                    }}
                    className={cn(
                      'flex h-8 w-full min-w-0 items-center gap-1 rounded-md pr-2 text-left text-[13px] transition-colors hover:bg-muted/70 hover:text-foreground',
                      focused ? 'bg-accent text-accent-foreground shadow-sm' : 'text-foreground/80',
                    )}
                    style={{ paddingLeft: `${10 + Math.min(depth, 6) * 14}px` }}
                  >
                    {expanded ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                    {expanded ? <FolderOpen size={14} className="shrink-0 text-primary/80" /> : <Folder size={14} className="shrink-0 text-primary/80" />}
                    <span className="min-w-0 truncate">{child.name}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="z-[9999] w-40 min-w-0 p-0.5">
                  <ContextMenuItem disabled={!canCreate} onSelect={() => onCreateNote(child.relativePath)}>新建笔记</ContextMenuItem>
                  <ContextMenuItem disabled={!canCreate} onSelect={() => onCreateFolder(child.relativePath)}>新建文件夹</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {expanded && (
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 w-px bg-border/70"
                    style={{ left: `${17 + Math.min(depth, 6) * 14}px` }}
                  />
                  {renderEntries(child, depth + 1)}
                </div>
              )}
            </React.Fragment>
          )
        })}
      {folder.files
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        .map((file) => {
          const selected = selectedPath === file.relativePath
          return (
            <div
              key={file.relativePath}
              className={cn(
                'group flex h-8 w-full min-w-0 items-center rounded-md transition-colors',
                selected ? 'bg-accent text-accent-foreground shadow-sm' : 'text-foreground/70 hover:bg-muted/70 hover:text-foreground',
              )}
              style={{ paddingLeft: `${18 + Math.min(depth, 6) * 14}px` }}
            >
              <button
                type="button"
                title={file.relativePath}
                onClick={() => onSelect(file.relativePath)}
                className="h-full min-w-0 flex-1 truncate text-left text-[13px]"
              >
                {displayDocumentTitle(file.name)}
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`删除笔记 ${displayDocumentTitle(file.name)}`}
                    onClick={() => onDelete(file)}
                    className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">删除笔记</TooltipContent>
              </Tooltip>
            </div>
          )
        })}
    </>
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin titlebar-no-drag">
      {files.length === 0
        ? <p className="px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">没有可显示的 Markdown 笔记</p>
        : renderEntries(tree, 0)}
    </div>
  )
}

type VaultSaveRequest = {
  relativePath: string
  content: string
  expectedSha256: string
}

type VaultSaveResult =
  | { ok: true; relativePath: string; sha256: string; modifiedAt: number }
  | { ok: false; reason: 'conflict' | 'error'; message?: string }

type VaultEditorFlush = () => Promise<boolean>

function VaultMarkdownEditor({
  readResult,
  vaultId,
  sessionId,
  onSave,
  onRename,
  onReload,
  onRegisterFlush,
  onOpenTutorial,
}: {
  readResult: VaultReadResult
  /** Stable renderer-safe identity of the currently authorized Vault. */
  vaultId: string
  /** 嵌入 Agent 右侧工作区时，用于接入 Agent 引用与右侧问答。 */
  sessionId?: string
  onSave: (request: VaultSaveRequest, options?: { silent?: boolean }) => Promise<VaultSaveResult>
  onRename: (name: string) => Promise<void>
  onReload: () => void
  onRegisterFlush?: (flush: VaultEditorFlush | null) => void
  onOpenTutorial: () => void
}): React.ReactElement {
  const documentController = React.useMemo(() => getVaultDocumentController(readResult, vaultId), [readResult.relativePath, vaultId])
  const documentSnapshot = React.useSyncExternalStore(
    documentController.subscribe,
    documentController.getSnapshot,
    documentController.getSnapshot,
  )
  const { draft, saving, conflict: saveConflict } = documentSnapshot
  const [filename, setFilename] = React.useState(displayDocumentTitle(readResult.relativePath.split('/').pop() ?? readResult.relativePath))
  const editorPageRef = React.useRef<HTMLDivElement>(null)
  const [selection, setSelection] = React.useState<VaultTextSelection | null>(null)
  const openSelectionChatPendingRef = React.useRef(false)
  const selectedChatModel = useAtomValue(selectedModelAtom)
  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const conversations = useAtomValue(conversationsAtom)
  const sideChatMap = useAtomValue(agentSideChatMapAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const setConversationDrafts = useSetAtom(conversationDraftsAtom)
  const setChatQuotedSelectionMap = useSetAtom(conversationQuotedSelectionMapAtom)
  const setSideChatMap = useSetAtom(agentSideChatMapAtom)
  const setSidePanelOpen = useSetAtom(agentSidePanelOpenAtomFamily(sessionId ?? 'standalone'))
  const setSidePanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const focusAgentSessionInput = useFocusAgentSessionInput()
  // Keep the reading position per surface and per note, so switching the center
  // view, a right-workspace tab, or the open note does not jump back to the top.
  const editorHandleRef = React.useRef<LiveMarkdownEditorHandle | null>(null)
  const getEditorView = React.useCallback(() => editorHandleRef.current?.getView() ?? null, [])
  const { onEditorReady: handleEditorReady, takeOver: takeOverScrollRestore } = useVaultScrollMemory({
    getView: getEditorView,
    storageKey: getVaultScrollKey(vaultId, readResult.relativePath, sessionId),
  })

  const clearSelection = React.useCallback(() => setSelection(null), [])
  const handleTextSelectionChange = React.useCallback((nextSelection: LiveMarkdownTextSelection | null) => {
    if (!nextSelection) {
      clearSelection()
      return
    }
    const text = nextSelection.text.slice(0, MAX_QUOTED_CHARS)
    setSelection({ ...nextSelection, text })
  }, [clearSelection])
  const createQuote = React.useCallback(() => selection ? ({
    text: selection.text,
    filePath: readResult.relativePath,
    sourceType: 'file' as const,
    sourceLabel: `Obsidian · ${readResult.relativePath}`,
    capturedAt: Date.now(),
  }) : null, [readResult.relativePath, selection])
  const addSelectionToAgent = React.useCallback(() => {
    if (!sessionId) {
      toast.info('请从 Agent 会话右侧打开 Obsidian 后再添加引用')
      return
    }
    const quote = createQuote()
    if (!quote) return
    if (!insertAgentInputQuote(sessionId, quote)) {
      setQuotedSelectionMap((previous) => new Map(previous).set(sessionId, quote))
    }
    clearSelection()
    focusAgentSessionInput(sessionId)
  }, [clearSelection, createQuote, focusAgentSessionInput, sessionId, setQuotedSelectionMap])
  const openSelectionChat = React.useCallback(async (): Promise<void> => {
    if (!sessionId) {
      toast.info('请从 Agent 会话右侧打开 Obsidian 后再发起右侧问答')
      return
    }
    const quote = createQuote()
    if (!quote || openSelectionChatPendingRef.current) return

    const activeConversationId = sideChatMap.get(sessionId) ?? null
    // 右侧已绑定有效 Chat 时始终复用，避免因激活 Tab 状态短暂不同步而重复创建会话。
    if (activeConversationId) {
      setChatQuotedSelectionMap((previous) => new Map(previous).set(activeConversationId, quote))
      setSidePanelOpen(true)
      setSidePanelTabMap((previous) => new Map(previous).set(sessionId, 'chat'))
      clearSelection()
      focusChatInput(activeConversationId)
      return
    }

    openSelectionChatPendingRef.current = true
    try {
      const conversation = await getOrCreateSideChat(sessionId, () => window.electronAPI.createConversation(
        'Obsidian 选区问答',
        selectedChatModel?.modelId,
        selectedChatModel?.channelId,
      ))
      setConversations((previous) => previous.some((item) => item.id === conversation.id) ? previous : [conversation, ...previous])
      setConversationDrafts((previous) => new Map(previous).set(conversation.id, '我的问题：'))
      setSideChatMap((previous) => new Map(previous).set(sessionId, conversation.id))
      setSidePanelOpen(true)
      setSidePanelTabMap((previous) => new Map(previous).set(sessionId, 'chat'))
      setChatQuotedSelectionMap((previous) => new Map(previous).set(conversation.id, quote))
      clearSelection()
      focusChatInput(conversation.id)
    } catch (error) {
      console.error('[VaultView] 打开 Obsidian 选区聊天失败:', error)
      toast.error('打开右侧问答失败')
    } finally {
      openSelectionChatPendingRef.current = false
    }
  }, [
    clearSelection,
    conversations,
    createQuote,
    selectedChatModel,
    sessionId,
    setConversationDrafts,
    setConversations,
    setChatQuotedSelectionMap,
    setQuotedSelectionMap,
    setSideChatMap,
    setSidePanelOpen,
    setSidePanelTabMap,
    sideChatMap,
  ])

  const updateDraft = React.useCallback((nextDraft: string): void => {
    documentController.setDraft(nextDraft)
  }, [documentController])

  React.useEffect(() => {
    if (documentController.observeRemote(readResult) === 'conflict') {
      toast.error('笔记已被外部修改；已保留本地草稿')
    }
  }, [documentController, readResult])

  const handleEditorPageWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('.vault-ink-mde')) return
    const scroller = editorPageRef.current?.querySelector<HTMLElement>('.vault-ink-mde .cm-scroller')
    if (!scroller) return
    // The wheel originated outside CodeMirror, so its scroller listener cannot
    // observe it. Treat this forwarded scroll as explicit reader intent before
    // moving the viewport, otherwise the bounded mount-time correction can undo it.
    takeOverScrollRestore()
    scroller.scrollTop += event.deltaY
    scroller.scrollLeft += event.deltaX
  }

  const saveLatest = React.useCallback(async (silent = false): Promise<boolean> => {
    const result = await documentController.flush((request) => onSave(request, { silent }))
    if (!result.ok) {
      toast.error(result.reason === 'conflict' ? '笔记已被外部修改；已保留本地草稿' : (result.message ?? '保存失败；已保留本地草稿'))
      return false
    }
    return true
  }, [documentController, onSave])

  const flushPendingSave = React.useCallback((): Promise<boolean> => saveLatest(true), [saveLatest])

  React.useEffect(() => {
    onRegisterFlush?.(flushPendingSave)
    return () => onRegisterFlush?.(null)
  }, [flushPendingSave, onRegisterFlush])

  React.useEffect(() => {
    if (saving || saveConflict || draft === documentSnapshot.base.content) return
    const timer = window.setTimeout(() => { void saveLatest(true) }, 700)
    return () => window.clearTimeout(timer)
  }, [documentSnapshot.base.content, draft, saveConflict, saveLatest, saving])

  React.useEffect(() => () => {
    // Best effort for unmounts such as Session/side-panel changes. Explicit
    // navigation paths await the same flush before replacing the editor.
    void flushPendingSave()
  }, [flushPendingSave])

  const rename = async (): Promise<void> => {
    const currentName = displayDocumentTitle(readResult.relativePath.split('/').pop() ?? readResult.relativePath)
    if (!filename.trim() || filename.trim() === currentName) {
      setFilename(currentName)
      return
    }
    if (!await flushPendingSave()) return
    await onRename(filename.trim())
  }

  const copyLocalDraft = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(draft)
      toast.success('未保存草稿已复制')
    } catch {
      toast.error('无法复制本地草稿')
    }
  }


  return (
    <div
      ref={editorPageRef}
      onWheel={handleEditorPageWheel}
      className="vault-note-editor min-h-0 flex-1 overflow-hidden titlebar-no-drag"
    >
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-5 py-5">
        <div className="vault-note-editor-titlebar mb-5 flex min-w-0 items-center gap-2">
          <input
            aria-label="重命名笔记"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            onBlur={() => { void rename() }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setFilename(displayDocumentTitle(readResult.relativePath.split('/').pop() ?? readResult.relativePath))
                event.currentTarget.blur()
              }
            }}
            className="h-9 min-w-0 flex-1 bg-transparent px-0 text-2xl font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          {saveConflict && (
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-destructive">
              <span>草稿未保存</span>
              <button type="button" onClick={() => { void copyLocalDraft() }} className="rounded px-1.5 py-1 hover:bg-destructive/10">复制草稿</button>
              <button type="button" onClick={() => { documentController.discardLocalDraft(); onReload() }} className="rounded px-1.5 py-1 hover:bg-destructive/10">丢弃并重载</button>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${VAULT_NAME} 使用帮助`}
                onClick={onOpenTutorial}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <CircleHelp size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{VAULT_NAME} 使用帮助（自动保存；Cmd/Ctrl + S 可立即保存）</TooltipContent>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1">
          <VaultLiveMarkdownEditor
            ref={editorHandleRef}
            relativePath={readResult.relativePath}
            value={draft}
            onChange={updateDraft}
            onSave={() => { void flushPendingSave() }}
            onReady={handleEditorReady}
            onTextSelectionChange={handleTextSelectionChange}
          />
        </div>
      </div>
      {selection && (
        <SelectionActionPopover
          x={selection.x}
          y={selection.y}
          onAddToAgent={addSelectionToAgent}
          onOpenChat={openSelectionChat}
        />
      )}
    </div>
  )
}

function VaultMarkdownPane({
  readResult,
  vaultId,
  sessionId,
  loading,
  hasVault,
  reopenVersion,
  onSave,
  onRename,
  onReload,
  onRegisterFlush,
  onOpenTutorial,
}: {
  readResult: VaultReadResult | null
  vaultId?: string
  sessionId?: string
  loading: boolean
  hasVault: boolean
  reopenVersion: number
  onSave: (request: VaultSaveRequest, options?: { silent?: boolean }) => Promise<VaultSaveResult>
  onRename: (name: string) => Promise<void>
  onReload: () => void
  onRegisterFlush: (flush: VaultEditorFlush | null) => void
  onOpenTutorial: () => void
}): React.ReactElement {
  if (loading || !readResult || !vaultId) {
    return (
      <section className="flex min-w-0 flex-1 flex-col bg-muted/25">
        <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-5 py-5">
          <div className="titlebar-no-drag flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 truncate px-4 text-sm text-muted-foreground">{loading ? '正在加载笔记' : hasVault ? '选择一篇笔记开始编辑' : '从左下角选择或创建 Vault'}</p>
          </div>
          {loading && (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-muted/25">
      <VaultContentErrorBoundary resetKey={getVaultEditorKey(readResult.relativePath, reopenVersion)}>
        <VaultMarkdownEditor
          key={getVaultEditorKey(readResult.relativePath, reopenVersion)}
          readResult={readResult}
          vaultId={vaultId}
          sessionId={sessionId}
          onSave={onSave}
          onRename={onRename}
          onReload={onReload}
          onRegisterFlush={onRegisterFlush}
          onOpenTutorial={onOpenTutorial}
        />
      </VaultContentErrorBoundary>
    </section>
  )
}

export function VaultView({ embedded = false, sessionId }: { embedded?: boolean; sessionId?: string }): React.ReactElement {
  const vaultSessionScope = getVaultSessionScope(sessionId)
  const [config, setConfig] = React.useState<VaultSummary | null>(null)
  const [candidates, setCandidates] = React.useState<VaultCandidate[]>([])
  const [vaultSwitcherOpen, setVaultSwitcherOpen] = React.useState(false)
  const [candidatesLoading, setCandidatesLoading] = React.useState(false)
  const [files, setFiles] = React.useState<VaultFileEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [fileLoading, setFileLoading] = React.useState(false)
  const [editorReopenVersion, setEditorReopenVersion] = React.useState(0)
  const [selectedFile, setSelectedFile] = useAtom(selectedVaultFileAtomFamily(vaultSessionScope))
  const [focusedFolder, setFocusedFolder] = useAtom(focusedVaultFolderAtomFamily(vaultSessionScope))
  const [readResult, setReadResult] = useAtom(vaultReadResultAtomFamily(vaultSessionScope))
  const [refreshToken, setRefreshToken] = useAtom(vaultRefreshTokenAtom)
  const [vaultHelpOpen, setVaultHelpOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<VaultFileEntry | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [newFolderParentPath, setNewFolderParentPath] = React.useState<string | null>(null)
  const [newFolderName, setNewFolderName] = React.useState('')
  const [creatingFolder, setCreatingFolder] = React.useState(false)
  const [vaultTreeAction, setVaultTreeAction] = React.useState<{ type: 'expand' | 'collapse'; version: number }>({ type: 'collapse', version: 0 })
  const [vaultSidebarWidth, setVaultSidebarWidth] = React.useState(embedded ? 200 : 280)
  const vaultSidebarWidthRef = React.useRef(vaultSidebarWidth)
  const vaultSidebarDragCleanupRef = React.useRef<(() => void) | null>(null)
  const selectedFileRef = React.useRef(selectedFile)
  // Keep the ref in sync synchronously with user actions. Refreshes can start
  // before React commits the atom update (notably after rename), so relying on
  // the effect below can make a refresh reread the old path and report a false
  // "opened note cannot be refreshed" error.
  const selectFile = React.useCallback((relativePath: string | null): void => {
    selectedFileRef.current = relativePath
    setSelectedFile(relativePath)
  }, [setSelectedFile])
  // Start from wall-clock time so a remounted workspace tab still supersedes an older IPC snapshot.
  const focusSequenceRef = React.useRef(Date.now())
  const readRequestRef = React.useRef(0)
  const initialRefreshRef = React.useRef(true)
  const editorFlushRef = React.useRef<VaultEditorFlush | null>(null)
  const flushCurrentEditor = React.useCallback(async (): Promise<boolean> => editorFlushRef.current ? editorFlushRef.current() : true, [])
  const registerEditorFlush = React.useCallback((flush: VaultEditorFlush | null): void => {
    editorFlushRef.current = flush
  }, [])

  React.useEffect(() => {
    selectedFileRef.current = selectedFile
  }, [selectedFile])

  React.useEffect(() => {
    vaultSidebarWidthRef.current = vaultSidebarWidth
  }, [vaultSidebarWidth])

  React.useEffect(() => () => {
    vaultSidebarDragCleanupRef.current?.()
  }, [])

  const handleVaultSidebarResizeStart = React.useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    vaultSidebarDragCleanupRef.current?.()
    const startX = event.clientX
    const startWidth = vaultSidebarWidthRef.current
    const maxWidth = Math.max(VAULT_SIDEBAR_MIN_WIDTH, Math.min(VAULT_SIDEBAR_MAX_WIDTH, window.innerWidth - 320))

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const nextWidth = Math.min(maxWidth, Math.max(VAULT_SIDEBAR_MIN_WIDTH, startWidth + moveEvent.clientX - startX))
      setVaultSidebarWidth(nextWidth)
    }
    const cleanup = (): void => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', cleanup)
      if (vaultSidebarDragCleanupRef.current === cleanup) vaultSidebarDragCleanupRef.current = null
    }
    vaultSidebarDragCleanupRef.current = cleanup
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', cleanup)
  }, [])

  const updateAgentFocus = React.useCallback((focus: Omit<VaultFocus, 'sequence'> | null): void => {
    if (!sessionId) return
    const next = focus ? { ...focus, sequence: ++focusSequenceRef.current } : null
    void window.electronAPI.setVaultUserContext(sessionId, next, true)
  }, [sessionId])

  React.useEffect(() => {
    if (!sessionId) return
    return () => {
      void window.electronAPI.setVaultUserContext(sessionId, null, false)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (!selectedFile) return
    updateAgentFocus({ kind: 'file', relativePath: selectedFile })
  }, [selectedFile, updateAgentFocus])

  const refresh = React.useCallback(async ({ showLoading = false }: { showLoading?: boolean } = {}): Promise<void> => {
    if (showLoading) setLoading(true)
    try {
      const nextConfig = await window.electronAPI.getVaultConfig()
      setConfig(nextConfig)
      const nextFiles = nextConfig ? await window.electronAPI.listVaultFiles() : []
      setFiles((current) => hasSameVaultTreeEntries(current, nextFiles) ? current : nextFiles)
      if (!nextConfig) {
        selectFile(null)
        setReadResult(null)
      } else if (selectedFileRef.current) {
        const relativePath = selectedFileRef.current
        if (!nextFiles.some((file) => file.relativePath === relativePath)) {
          selectFile(null)
          setReadResult(null)
          toast.message('已打开的笔记不存在')
          return
        }
        const requestId = ++readRequestRef.current
        try {
          const result = await window.electronAPI.readVaultFile(relativePath)
          if (requestId === readRequestRef.current) setReadResult(result)
        } catch (error) {
          if (requestId === readRequestRef.current) {
            toast.error(error instanceof Error ? error.message : '无法刷新已打开的笔记')
          }
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `无法读取 ${VAULT_NAME}`)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [selectFile, setReadResult])

  React.useEffect(() => {
    const showLoading = initialRefreshRef.current
    initialRefreshRef.current = false
    void refresh({ showLoading })
  }, [refresh, refreshToken])

  // Agent tools can edit a Vault file directly, outside the renderer's own save
  // IPC. Poll only the currently open note, never the whole Vault tree, so this
  // stays scoped and a remote edit is reflected without changing navigation.
  React.useEffect(() => {
    const relativePath = readResult?.relativePath
    const sha256 = readResult?.sha256
    if (!relativePath || !sha256) return
    let cancelled = false
    let checking = false
    const checkCurrentFile = async (): Promise<void> => {
      if (checking || cancelled || selectedFileRef.current !== relativePath) return
      checking = true
      try {
        const next = await window.electronAPI.readVaultFile(relativePath)
        if (!cancelled && selectedFileRef.current === relativePath && next.sha256 !== sha256) setReadResult(next)
      } catch {
        // A concurrent rename/delete follows the existing refresh and open-file
        // error paths; the lightweight current-file check remains silent.
      } finally {
        checking = false
      }
    }
    const timer = window.setInterval(() => { void checkCurrentFile() }, 1_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [readResult?.relativePath, readResult?.sha256, setReadResult])

  const refreshVaultCandidates = React.useCallback(async (): Promise<void> => {
    setCandidatesLoading(true)
    try {
      setCandidates(await window.electronAPI.listVaultCandidates())
    } catch {
      setCandidates([])
    } finally {
      setCandidatesLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshVaultCandidates()
  }, [refreshVaultCandidates])

  const openFile = React.useCallback(async (
    relativePath: string,
    { discardLocalDraft = false, forceReopen = false }: { discardLocalDraft?: boolean; forceReopen?: boolean } = {},
  ): Promise<void> => {
    if (!discardLocalDraft && !await flushCurrentEditor()) return
    const remountEditor = shouldRemountVaultEditor(selectedFileRef.current, relativePath, forceReopen)
    const requestId = ++readRequestRef.current
    selectFile(relativePath)
    setFileLoading(true)
    try {
      const result = await window.electronAPI.readVaultFile(relativePath)
      if (requestId === readRequestRef.current) {
        setReadResult(result)
        // Only the explicit conflict-recovery action recreates the editor.
        // Repeated ordinary clicks must preserve its CodeMirror instance.
        if (remountEditor) setEditorReopenVersion((version) => version + 1)
      }
    } catch (error) {
      if (requestId === readRequestRef.current) {
        toast.error(error instanceof Error ? error.message : '无法打开笔记')
        setReadResult(null)
      }
    } finally {
      if (requestId === readRequestRef.current) setFileLoading(false)
    }
  }, [flushCurrentEditor, selectFile, setReadResult])

  const selectVaultManually = async (): Promise<void> => {
    if (!await flushCurrentEditor()) return
    const selected = await window.electronAPI.selectVault({ inboxPath: 'Proma Inbox', allowAgentWrites: false })
    if (!selected) return
    setConfig(selected)
    selectFile(null)
    setReadResult(null)
    setVaultSwitcherOpen(false)
    setRefreshToken((value) => value + 1)
    toast.success(`已连接 ${selected.displayName}`)
  }

  const createPromaVault = async (): Promise<void> => {
    if (!await flushCurrentEditor()) return
    try {
      const selected = await window.electronAPI.selectDefaultVault()
      setConfig(selected)
      selectFile(null)
      setReadResult(null)
      setVaultSwitcherOpen(false)
      setRefreshToken((value) => value + 1)
      toast.success(`已创建 ${selected.displayName}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `无法创建 ${PROMA_MANAGED_VAULT_DISPLAY_NAME}`)
    }
  }

  const connectDiscoveredVault = async (candidate: VaultCandidate): Promise<void> => {
    if (!await flushCurrentEditor()) return
    try {
      const selected = candidate.isPromaManaged
        ? await window.electronAPI.selectDefaultVault()
        : await window.electronAPI.authorizeDiscoveredVault(candidate.path, { inboxPath: 'Proma Inbox', allowAgentWrites: false })
      setConfig(selected)
      selectFile(null)
      setReadResult(null)
      setVaultSwitcherOpen(false)
      setRefreshToken((value) => value + 1)
      toast.success(`已连接 ${selected.displayName}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `无法连接检测到的 ${VAULT_NAME}`)
    }
  }

  const createNote = async (): Promise<void> => {
    if (!config) return
    try {
      const result = await window.electronAPI.createUntitledVaultFile()
      if (!result.ok) return
      setRefreshToken((value) => value + 1)
      await openFile(result.relativePath)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法创建笔记')
    }
  }

  const createNoteInFolder = async (folderPath: string): Promise<void> => {
    if (!config) return
    try {
      const result = await window.electronAPI.createUntitledVaultFileInFolder(folderPath)
      if (!result.ok) return
      setRefreshToken((value) => value + 1)
      await openFile(result.relativePath)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法创建笔记')
    }
  }

  const openCreateFolderDialog = (folderPath: string): void => {
    if (!config) return
    setNewFolderParentPath(folderPath)
    setNewFolderName('')
  }

  const createFolder = async (): Promise<void> => {
    if (newFolderParentPath === null) return
    const name = newFolderName.trim()
    if (!name) return
    setCreatingFolder(true)
    try {
      const relativePath = newFolderParentPath ? `${newFolderParentPath}/${name}` : name
      await window.electronAPI.createVaultFolder(relativePath)
      setNewFolderParentPath(null)
      setRefreshToken((value) => value + 1)
      toast.success(`已创建文件夹 ${name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法创建文件夹')
    } finally {
      setCreatingFolder(false)
    }
  }

  const save = React.useCallback(async (request: VaultSaveRequest, { silent = false }: { silent?: boolean } = {}): Promise<VaultSaveResult> => {
    try {
      const result = await window.electronAPI.writeVaultFile(request)
      if (!result.ok) return { ok: false, reason: 'conflict' }

      // A write can finish after the user has opened another note. Never replace
      // that newer view with a stale save acknowledgement.
      setReadResult((previous) => previous?.relativePath === request.relativePath ? {
        relativePath: result.relativePath,
        content: request.content,
        sha256: result.sha256,
        modifiedAt: result.modifiedAt,
      } : previous)
      const nextFiles = await window.electronAPI.listVaultFiles()
      setFiles((current) => hasSameVaultTreeEntries(current, nextFiles) ? current : nextFiles)
      if (!silent) toast.success(`已保存到 ${VAULT_NAME}`)
      return result
    } catch (error) {
      return { ok: false, reason: 'error', message: error instanceof Error ? error.message : '保存失败' }
    }
  }, [setReadResult])

  const rename = async (name: string): Promise<void> => {
    if (!readResult) return
    try {
      // Re-read after the editor flushes so rename validates the revision that
      // is actually on disk rather than a stale render snapshot.
      const current = await window.electronAPI.readVaultFile(readResult.relativePath)
      const renamed = await window.electronAPI.renameVaultFile({
        relativePath: current.relativePath,
        name,
        expectedSha256: current.sha256,
      })
      selectFile(renamed.relativePath)
      setReadResult(renamed)
      setRefreshToken((value) => value + 1)
      toast.success('已重命名笔记')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法重命名笔记')
    }
  }

  const deleteNote = async (): Promise<void> => {
    if (!deleteTarget || deleting) return
    const deletingCurrentFile = selectedFileRef.current === deleteTarget.relativePath
    // Deleting is irreversible, so never let a pending debounce turn the
    // current document's draft into a silent loss. A failed flush leaves the
    // editor and its explicit copy/reload recovery controls intact.
    if (deletingCurrentFile && !await flushCurrentEditor()) return
    setDeleting(true)
    try {
      // The flush can update the controller before React commits readResult.
      // Read again so delete's CAS protects the exact version on disk.
      const current = deletingCurrentFile
        ? await window.electronAPI.readVaultFile(deleteTarget.relativePath)
        : null
      await window.electronAPI.deleteVaultFile({
        relativePath: deleteTarget.relativePath,
        expectedSha256: current?.sha256,
      })

      if (deletingCurrentFile) {
        ++readRequestRef.current
        selectFile(null)
        setReadResult(null)
        setFileLoading(false)
        if (sessionId) await window.electronAPI.setVaultUserContext(sessionId, null, true)
      }
      setDeleteTarget(null)
      setRefreshToken((value) => value + 1)
      toast.success('已删除 Vault 笔记')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法删除笔记')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
  }


  return (
    <>
      <main className={cn('flex h-full min-h-0 flex-col bg-muted/25', embedded && 'min-w-[360px] bg-content-area')}>
        {!embedded && <div className="relative z-10 h-[100px] shrink-0 border-b border-border/60 bg-muted/25" />}
        <div className="relative flex min-h-0 flex-1">
          <aside
            className="relative flex shrink-0 flex-col border-r border-border/50 bg-muted/25"
            style={{ width: vaultSidebarWidth }}
          >
              <header className={cn('flex h-14 items-center gap-2 px-3', embedded ? 'titlebar-no-drag' : 'titlebar-drag-region')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{config?.displayName ?? '选择 Vault'}</p>
                </div>
                <div className="flex items-center gap-0.5 titlebar-no-drag">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={vaultTreeAction.type === 'expand' ? '全部折叠文件树' : '全部展开文件树'}
                        onClick={() => setVaultTreeAction((current) => ({
                          type: current.type === 'expand' ? 'collapse' : 'expand',
                          version: current.version + 1,
                        }))}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ChevronsUpDown size={15} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{vaultTreeAction.type === 'expand' ? '全部折叠' : '全部展开'}</TooltipContent>
                  </Tooltip>
                  {config && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="新建笔记" onClick={() => { void createNote() }} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                          <Plus size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>新建笔记</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </header>
              <VaultFileList
                files={files}
                selectedPath={selectedFile}
                focusedFolder={focusedFolder}
                onSelect={(path) => { setFocusedFolder(null); void openFile(path) }}
                onFocusFolder={(relativePath) => { setFocusedFolder(relativePath); updateAgentFocus({ kind: 'folder', relativePath }) }}
                onDelete={setDeleteTarget}
                onCreateNote={(folderPath) => { void createNoteInFolder(folderPath) }}
                onCreateFolder={openCreateFolderDialog}
                canCreate={config !== null}
                treeAction={vaultTreeAction}
              />
              <div className="titlebar-no-drag flex shrink-0 items-center border-t border-border/50 p-2">
                <Popover
                  open={vaultSwitcherOpen}
                  onOpenChange={(open) => {
                    setVaultSwitcherOpen(open)
                    if (open) void refreshVaultCandidates()
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="切换 Vault"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{config?.displayName ?? '选择 Vault'}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-72 p-1.5">
                    <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Vault</p>
                    <div className="max-h-64 overflow-y-auto scrollbar-thin">
                      {candidatesLoading ? (
                        <div className="flex items-center justify-center py-5 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
                      ) : candidates.length > 0 ? (
                        candidates.map((candidate) => (
                          <button
                            key={candidate.path}
                            type="button"
                            onClick={() => { void connectDiscoveredVault(candidate) }}
                            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                          >
                            <BookOpen size={15} className="shrink-0 text-primary" />
                            <span className="min-w-0 flex-1 truncate">{getVaultCandidateDisplayName(candidate)}</span>
                            {candidate.isPromaManaged && <span className="shrink-0 text-[10px] text-muted-foreground">{PROMA_SELF_MANAGED_VAULT_LABEL}</span>}
                          </button>
                        ))
                      ) : (
                        <p className="px-2 py-4 text-center text-xs leading-relaxed text-muted-foreground">未发现本机 Obsidian Vault</p>
                      )}
                    </div>
                    <div className="mt-1 border-t border-border/60 pt-1">
                      <button
                        type="button"
                        onClick={() => { void createPromaVault() }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <Plus size={15} className="shrink-0 text-muted-foreground" />
                        创建 Proma Vault
                      </button>
                      <button
                        type="button"
                        onClick={() => { void selectVaultManually() }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <FolderOpen size={15} className="shrink-0 text-muted-foreground" />
                        打开本地仓库
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            <div
              aria-hidden="true"
              className="titlebar-no-drag absolute right-0 top-0 bottom-0 z-10 w-3 translate-x-1/2 cursor-col-resize"
              onMouseDown={handleVaultSidebarResizeStart}
            />
          </aside>
          <VaultMarkdownPane
            readResult={readResult}
            vaultId={config?.vaultId}
            sessionId={sessionId}
            loading={fileLoading}
            hasVault={config !== null}
            reopenVersion={editorReopenVersion}
            onSave={save}
            onRename={rename}
            onReload={() => { if (readResult) void openFile(readResult.relativePath, { discardLocalDraft: true, forceReopen: true }) }}
            onRegisterFlush={registerEditorFlush}
            onOpenTutorial={() => setVaultHelpOpen(true)}
          />
        </div>
      </main>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="删除 Vault 笔记？"
        description={deleteTarget ? `“${deleteTarget.relativePath}”将从 Vault 中永久删除，此操作无法撤销。` : undefined}
        confirmLabel="删除"
        loadingLabel="删除中"
        loading={deleting}
        onConfirm={deleteNote}
      />
      <Dialog
        open={newFolderParentPath !== null}
        onOpenChange={(open) => {
          if (!open && !creatingFolder) setNewFolderParentPath(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription>在{newFolderParentPath ? ` ${newFolderParentPath}` : ' Vault 根目录'}中创建文件夹。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createFolder()
            }}
            placeholder="文件夹名称"
            aria-label="文件夹名称"
          />
          <DialogFooter>
            <Button variant="outline" disabled={creatingFolder} onClick={() => setNewFolderParentPath(null)}>取消</Button>
            <Button disabled={!newFolderName.trim() || creatingFolder} onClick={() => { void createFolder() }}>
              {creatingFolder && <Loader2 className="mr-2 size-4 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={vaultHelpOpen} onOpenChange={setVaultHelpOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>在 Proma 中使用 {VAULT_NAME}</DialogTitle>
            <DialogDescription>Proma 直接读写本机已授权的 Markdown Vault；这些笔记也会继续保留在 {VAULT_NAME} 中。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm leading-6 text-muted-foreground">
            <section>
              <p className="font-medium text-foreground">切换与管理 Vault</p>
              <p>点击左下角的 Vault 名称可切换已发现的本地 Vault，也可以创建 Proma Vault 或打开本地仓库。云端 Vault 需先同步或挂载到本机。</p>
            </section>
            <section>
              <p className="font-medium text-foreground">浏览与新建笔记</p>
              <p>点击文件夹可展开或收起；左侧顶部按钮可一键展开或折叠全部文件夹，拖动中间分隔线可调整文件树宽度。右键点击文件夹可在该目录中新建笔记或文件夹。</p>
            </section>
            <section>
              <p className="font-medium text-foreground">编辑与自动保存</p>
              <p>输入停止 700ms 后会自动保存；按 Cmd/Ctrl + S 可立即保存。直接编辑标题并按 Enter 或移开焦点即可重命名笔记。</p>
            </section>
          </div>
          <DialogFooter>
            <Button onClick={() => setVaultHelpOpen(false)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
