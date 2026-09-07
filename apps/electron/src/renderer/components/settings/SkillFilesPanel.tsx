/**
 * SkillFilesPanel — Skill 子文件树 + 编辑器面板
 *
 * 用于在 Skill 详情页管理 Skill 目录下的资源文件（references/、scripts/、assets/ 等）。
 * SKILL.md 由主面板管理，不出现在文件树里。
 */

import * as React from 'react'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Pencil,
  Save,
  Trash2,
  X,
  RefreshCw,
} from 'lucide-react'
import type { SkillFileNode, SkillFileContent } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { SettingsCard } from './primitives'
import { cn } from '@/lib/utils'

interface SkillFilesPanelProps {
  workspaceSlug: string
  skillSlug: string
  /** watcher 通知；同一 Skill 只静默刷新资源树，不重置编辑状态。 */
  contentVersion?: number
  /** 文件总数（不含目录）变化时通知父组件，用于 Tab 徽章 */
  onFileCountChange?: (count: number) => void
}

function countTree(nodes: SkillFileNode[]): { files: number; dirs: number } {
  let files = 0
  let dirs = 0
  for (const node of nodes) {
    if (node.type === 'file') {
      files += 1
    } else {
      dirs += 1
      if (node.children) {
        const sub = countTree(node.children)
        files += sub.files
        dirs += sub.dirs
      }
    }
  }
  return { files, dirs }
}

function hasFile(nodes: SkillFileNode[], path: string): boolean {
  return nodes.some((node) => node.type === 'file'
    ? node.relativePath === path
    : hasFile(node.children ?? [], path))
}

export function SkillFilesPanel({ workspaceSlug, skillSlug, contentVersion = 0, onFileCountChange }: SkillFilesPanelProps): React.ReactElement {
  const [tree, setTree] = React.useState<SkillFileNode[]>([])
  const [loading, setLoading] = React.useState(true)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [selected, setSelected] = React.useState<string | null>(null)

  const [fileContent, setFileContent] = React.useState<SkillFileContent | null>(null)
  const [loadingFile, setLoadingFile] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [editText, setEditText] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [missingFile, setMissingFile] = React.useState(false)
  const [treeError, setTreeError] = React.useState(false)
  const scopeRef = React.useRef(0)
  const treeRequestRef = React.useRef(0)
  const fileRequestRef = React.useRef(0)
  const treeLoadedRef = React.useRef(false)
  const selectedRef = React.useRef(selected)
  selectedRef.current = selected
  const missingFileRef = React.useRef(missingFile)
  missingFileRef.current = missingFile

  const [creating, setCreating] = React.useState<{ type: 'file' | 'directory'; parent: string } | null>(null)
  const [createName, setCreateName] = React.useState('')

  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')

  const onFileCountChangeRef = React.useRef(onFileCountChange)
  React.useEffect(() => {
    onFileCountChangeRef.current = onFileCountChange
  }, [onFileCountChange])

  // 身份变化才重置状态；普通 watcher 通知不能卸载树、编辑器或清除草稿。
  React.useEffect(() => {
    ++scopeRef.current
    treeLoadedRef.current = false
    setTree([])
    setLoading(true)
    setTreeError(false)
    setSelected(null)
    selectedRef.current = null
    setFileContent(null)
    setLoadingFile(false)
    setEditing(false)
    setEditText('')
    setSaving(false)
    setMissingFile(false)
    missingFileRef.current = false
    setExpanded(new Set())
    setCreating(null)
    setCreateName('')
    setRenaming(null)
    setRenameValue('')
    onFileCountChangeRef.current?.(0)
    return () => {
      ++scopeRef.current
      ++treeRequestRef.current
      ++fileRequestRef.current
    }
  }, [workspaceSlug, skillSlug])

  const markMissing = React.useCallback((): void => {
    // 保留已加载内容/草稿；路径重新出现也不能自动解除锁定，须显式重新打开。
    missingFileRef.current = true
    setMissingFile(true)
    ++fileRequestRef.current
    setLoadingFile(false)
  }, [])

  const refreshTree = React.useCallback(async (): Promise<void> => {
    const scope = scopeRef.current
    const request = ++treeRequestRef.current
    const isCurrent = (): boolean => scope === scopeRef.current && request === treeRequestRef.current
    if (!treeLoadedRef.current) setLoading(true)
    try {
      const nodes = await window.electronAPI.listSkillFiles(workspaceSlug, skillSlug)
      if (!isCurrent()) return
      treeLoadedRef.current = true
      setTree(nodes)
      setTreeError(false)
      onFileCountChangeRef.current?.(countTree(nodes).files)
      if (selectedRef.current && !hasFile(nodes, selectedRef.current)) markMissing()
    } catch (err) {
      if (!isCurrent()) return
      console.error('[SkillFiles] 加载文件树失败:', err)
      setTreeError(true)
      toast.error('加载文件树失败')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [workspaceSlug, skillSlug, markMissing])

  React.useEffect(() => {
    void refreshTree()
    return () => { ++treeRequestRef.current }
  }, [refreshTree, contentVersion])

  const openFile = React.useCallback(
    async (relativePath: string): Promise<void> => {
      if (saving) return
      if (editing && editText !== (fileContent?.content ?? '')
        && !window.confirm('当前文件有未保存的修改，确认放弃并打开文件？')) return
      const scope = scopeRef.current
      const request = ++fileRequestRef.current
      const isCurrent = (): boolean => scope === scopeRef.current && request === fileRequestRef.current
      selectedRef.current = relativePath
      setSelected(relativePath)
      setMissingFile(false)
      missingFileRef.current = false
      setEditing(false)
      setFileContent(null)
      setLoadingFile(true)
      try {
        const result = await window.electronAPI.readSkillFile(workspaceSlug, skillSlug, relativePath)
        if (!isCurrent()) return
        setFileContent(result)
        setEditText(result.content ?? '')
      } catch (err) {
        if (!isCurrent()) return
        console.error('[SkillFiles] 读取文件失败:', err)
        toast.error(err instanceof Error ? err.message : '读取文件失败')
        setFileContent(null)
      } finally {
        if (isCurrent()) setLoadingFile(false)
      }
    },
    [workspaceSlug, skillSlug, saving, editing, editText, fileContent],
  )

  // 创建操作可能跨过一轮编辑；完成后必须使用最新草稿状态判断是否可切换。
  const openFileRef = React.useRef(openFile)
  openFileRef.current = openFile

  const toggleExpand = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const saveFile = async (): Promise<void> => {
    if (!fileContent || saving || missingFileRef.current) return
    const scope = scopeRef.current
    const request = fileRequestRef.current
    const isCurrent = (): boolean => scope === scopeRef.current && request === fileRequestRef.current
    const snapshot = editText
    setSaving(true)
    try {
      // 先核验以给出明确失效提示；主进程也拒绝创建缺失路径，封住核验后的删除竞态。
      const nodes = await window.electronAPI.listSkillFiles(workspaceSlug, skillSlug)
      if (!isCurrent() || missingFileRef.current) return
      if (!hasFile(nodes, fileContent.relativePath)) {
        markMissing()
        void refreshTree()
        return
      }
      await window.electronAPI.writeSkillFile(workspaceSlug, skillSlug, fileContent.relativePath, snapshot)
      if (!isCurrent() || missingFileRef.current) return
      setFileContent({ ...fileContent, content: snapshot, size: new Blob([snapshot]).size })
      setEditing(false)
      toast.success('已保存')
      void refreshTree()
    } catch (err) {
      if (!isCurrent()) return
      console.error('[SkillFiles] 保存文件失败:', err)
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      if (scope === scopeRef.current) setSaving(false)
    }
  }

  const startCreate = (type: 'file' | 'directory', parent: string): void => {
    setCreating({ type, parent })
    setCreateName('')
    if (parent) setExpanded((prev) => new Set(prev).add(parent))
  }

  const commitCreate = async (): Promise<void> => {
    if (!creating) return
    const name = createName.trim()
    if (!name) {
      setCreating(null)
      return
    }
    if (name.includes('/') || name.includes('\\')) {
      toast.error('名称不能包含 / 或 \\')
      return
    }
    const relativePath = creating.parent ? `${creating.parent}/${name}` : name
    if (saving) return
    const scope = scopeRef.current
    try {
      await window.electronAPI.createSkillEntry(workspaceSlug, skillSlug, relativePath, creating.type)
      if (scope !== scopeRef.current) return
      toast.success(`已创建${creating.type === 'directory' ? '目录' : '文件'}: ${name}`)
      setCreating(null)
      setCreateName('')
      await refreshTree()
      if (scope !== scopeRef.current) return
      if (creating.type === 'file') void openFileRef.current(relativePath)
    } catch (err) {
      if (scope !== scopeRef.current) return
      console.error('[SkillFiles] 创建失败:', err)
      toast.error(err instanceof Error ? err.message : '创建失败')
    }
  }

  const deleteEntry = async (node: SkillFileNode): Promise<void> => {
    const label = node.type === 'directory' ? '目录及其内容' : '文件'
    if (!window.confirm(`确认删除${label} "${node.relativePath}"？此操作不可撤销。`)) return
    if (saving) return
    const scope = scopeRef.current
    try {
      await window.electronAPI.deleteSkillEntry(workspaceSlug, skillSlug, node.relativePath)
      if (scope !== scopeRef.current) return
      toast.success('已删除')
      if (selectedRef.current === node.relativePath || selectedRef.current?.startsWith(node.relativePath + '/')) markMissing()
      void refreshTree()
    } catch (err) {
      if (scope !== scopeRef.current) return
      console.error('[SkillFiles] 删除失败:', err)
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const startRename = (node: SkillFileNode): void => {
    setRenaming(node.relativePath)
    setRenameValue(node.name)
  }

  const commitRename = async (node: SkillFileNode): Promise<void> => {
    const newName = renameValue.trim()
    if (!newName || newName === node.name) {
      setRenaming(null)
      return
    }
    if (newName.includes('/') || newName.includes('\\')) {
      toast.error('名称不能包含 / 或 \\')
      return
    }
    const parentParts = node.relativePath.split('/').slice(0, -1)
    const newRel = parentParts.length ? `${parentParts.join('/')}/${newName}` : newName
    if (saving) return
    const scope = scopeRef.current
    try {
      await window.electronAPI.renameSkillEntry(workspaceSlug, skillSlug, node.relativePath, newRel)
      if (scope !== scopeRef.current) return
      toast.success('已重命名')
      if (selectedRef.current === node.relativePath || selectedRef.current?.startsWith(node.relativePath + '/')) markMissing()
      setRenaming(null)
      void refreshTree()
    } catch (err) {
      if (scope !== scopeRef.current) return
      console.error('[SkillFiles] 重命名失败:', err)
      toast.error(err instanceof Error ? err.message : '重命名失败')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-1 pb-2 shrink-0 min-h-[28px]">
        <div className="text-xs text-muted-foreground">
          {loading
            ? '加载中...'
            : (() => {
                const { files, dirs } = countTree(tree)
                return `共 ${files} 个文件${tree.length === 0 ? '' : `，${dirs} 个目录`}`
              })()}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="新建文件（根目录）"
            onClick={() => startCreate('file', '')}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <FilePlus size={14} />
          </button>
          <button
            type="button"
            title="新建目录（根目录）"
            onClick={() => startCreate('directory', '')}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            title="刷新"
            onClick={() => void refreshTree()}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {treeError && <div role="alert" className="px-1 pb-2 text-xs text-destructive">资源列表刷新失败，已保留当前内容。请重试刷新。</div>}
      <SettingsCard divided={false} className="flex-1 min-h-0">
        <div className="grid grid-cols-[minmax(220px,1fr)_2fr] h-full min-h-[420px]">
          {/* Tree */}
          <div className="border-r border-border bg-muted/30 p-2 overflow-y-auto">
            {loading ? (
              <div className="px-2 py-4 text-xs text-muted-foreground">加载中...</div>
            ) : tree.length === 0 && !creating ? (
              <div className="px-2 py-6 text-xs text-muted-foreground flex flex-col items-center gap-3 text-center">
                <div>该 Skill 暂无其他资源文件</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => startCreate('file', '')}>
                    <FilePlus size={12} /> 新建文件
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => startCreate('directory', '')}>
                    <FolderPlus size={12} /> 新建目录
                  </Button>
                </div>
              </div>
            ) : (
              <FileTree
                nodes={tree}
                expanded={expanded}
                selected={selected}
                renaming={renaming}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                onCommitRename={commitRename}
                onCancelRename={() => setRenaming(null)}
                onToggle={toggleExpand}
                onSelect={(node) => {
                  if (node.type === 'file') void openFile(node.relativePath)
                  else toggleExpand(node.relativePath)
                }}
                onStartCreate={startCreate}
                onStartRename={startRename}
                onDelete={deleteEntry}
                creating={creating}
                createName={createName}
                setCreateName={setCreateName}
                onCommitCreate={commitCreate}
                onCancelCreate={() => setCreating(null)}
              />
            )}
          </div>

          {/* Editor */}
          <div className="flex flex-col min-w-0">
            {missingFile && <div role="alert" className="p-3 text-xs text-destructive">
              文件已被删除或重命名：{selected}。已保留当前内容和草稿，请先复制备份；保存已禁用，重新打开现有文件后才能保存。
            </div>}
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-6 text-center">
                从左侧选择文件以查看或编辑
              </div>
            ) : loadingFile ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                加载中...
              </div>
            ) : !fileContent ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-6 text-center">
                无法加载该文件
              </div>
            ) : !fileContent.isText ? (
              <div className="flex-1 flex flex-col items-center justify-center text-xs text-muted-foreground p-6 text-center gap-2">
                <FileIcon size={20} />
                <div className="font-mono">{fileContent.relativePath}</div>
                <div>二进制文件（{formatSize(fileContent.size)}），不支持内置编辑</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
                  <div className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">
                    {fileContent.relativePath}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground">
                      {formatSize(fileContent.size)}
                    </span>
                    {!editing ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={missingFile} className="h-7">
                        <Pencil size={12} /> 编辑
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (missingFile && !window.confirm('文件已失效，确认放弃保留的草稿？')) return
                            setEditText(fileContent.content ?? '')
                            setEditing(false)
                          }}
                          disabled={saving}
                          className="h-7"
                        >
                          <X size={12} /> 取消
                        </Button>
                        <Button size="sm" onClick={() => void saveFile()} disabled={saving || missingFile} className="h-7">
                          <Save size={12} /> {saving ? '保存中...' : '保存'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {editing ? (
                  <textarea
                    value={editText}
                    readOnly={saving}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 bg-transparent text-xs font-mono resize-none p-3 focus:outline-none border-0"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="flex-1 bg-transparent text-xs font-mono p-3 overflow-auto whitespace-pre-wrap m-0">
                    {fileContent.content ?? ''}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}

// ===== File Tree =====

interface FileTreeProps {
  nodes: SkillFileNode[]
  expanded: Set<string>
  selected: string | null
  renaming: string | null
  renameValue: string
  setRenameValue: (v: string) => void
  onCommitRename: (node: SkillFileNode) => void
  onCancelRename: () => void
  onToggle: (path: string) => void
  onSelect: (node: SkillFileNode) => void
  onStartCreate: (type: 'file' | 'directory', parent: string) => void
  onStartRename: (node: SkillFileNode) => void
  onDelete: (node: SkillFileNode) => void
  creating: { type: 'file' | 'directory'; parent: string } | null
  createName: string
  setCreateName: (v: string) => void
  onCommitCreate: () => void
  onCancelCreate: () => void
}

function FileTree(props: FileTreeProps): React.ReactElement {
  return (
    <ul className="space-y-0.5">
      {/* 根目录新建占位 */}
      {props.creating && props.creating.parent === '' && (
        <CreatePlaceholder
          type={props.creating.type}
          depth={0}
          value={props.createName}
          onChange={props.setCreateName}
          onCommit={props.onCommitCreate}
          onCancel={props.onCancelCreate}
        />
      )}
      {props.nodes.map((node) => (
        <TreeNode key={node.relativePath} node={node} depth={0} {...props} />
      ))}
    </ul>
  )
}

interface TreeNodeProps extends FileTreeProps {
  node: SkillFileNode
  depth: number
}

function TreeNode(props: TreeNodeProps): React.ReactElement {
  const { node, depth } = props
  const isExpanded = props.expanded.has(node.relativePath)
  const isSelected = props.selected === node.relativePath
  const isRenaming = props.renaming === node.relativePath

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 px-1 py-0.5 rounded text-xs cursor-pointer select-none',
          isSelected ? 'bg-accent text-foreground' : 'hover:bg-accent/60 text-foreground/80',
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => !isRenaming && props.onSelect(node)}
      >
        <span className="shrink-0 w-3.5">
          {node.type === 'directory' ? (
            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {node.type === 'directory' ? (
            isExpanded ? <FolderOpen size={12} /> : <Folder size={12} />
          ) : (
            <FileIcon size={12} />
          )}
        </span>
        {isRenaming ? (
          <input
            autoFocus
            value={props.renameValue}
            onChange={(e) => props.setRenameValue(e.target.value)}
            onBlur={() => props.onCommitRename(node)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onCommitRename(node)
              else if (e.key === 'Escape') props.onCancelRename()
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-background border border-border rounded px-1 text-xs"
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}

        {/* Action buttons */}
        {!isRenaming && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
            {node.type === 'directory' && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onStartCreate('file', node.relativePath)
                  }}
                  className="p-0.5 hover:text-foreground text-muted-foreground"
                  title="在此新建文件"
                >
                  <FilePlus size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onStartCreate('directory', node.relativePath)
                  }}
                  className="p-0.5 hover:text-foreground text-muted-foreground"
                  title="在此新建目录"
                >
                  <FolderPlus size={11} />
                </button>
              </>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                props.onStartRename(node)
              }}
              className="p-0.5 hover:text-foreground text-muted-foreground"
              title="重命名"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                props.onDelete(node)
              }}
              className="p-0.5 hover:text-destructive text-muted-foreground"
              title="删除"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {node.type === 'directory' && isExpanded && (
        <ul className="space-y-0.5">
          {props.creating && props.creating.parent === node.relativePath && (
            <CreatePlaceholder
              type={props.creating.type}
              depth={depth + 1}
              value={props.createName}
              onChange={props.setCreateName}
              onCommit={props.onCommitCreate}
              onCancel={props.onCancelCreate}
            />
          )}
          {(node.children ?? []).map((child) => (
            <TreeNode key={child.relativePath} {...props} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function CreatePlaceholder({
  type,
  depth,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  type: 'file' | 'directory'
  depth: number
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}): React.ReactElement {
  return (
    <li>
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded text-xs bg-muted"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <span className="shrink-0 w-3.5" />
        <span className="shrink-0 text-muted-foreground">
          {type === 'directory' ? <Folder size={12} /> : <FileIcon size={12} />}
        </span>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit()
            else if (e.key === 'Escape') onCancel()
          }}
          placeholder={type === 'directory' ? '目录名' : '文件名'}
          className="flex-1 min-w-0 bg-background border border-border rounded px-1 text-xs"
        />
      </div>
    </li>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
