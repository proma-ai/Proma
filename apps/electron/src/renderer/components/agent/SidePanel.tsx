/**
 * SidePanel — Agent 侧面板容器
 *
 * 直接展示文件浏览器，默认打开状态。
 * 切换按钮在面板关闭时显示活动指示点。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { X, FolderOpen, ExternalLink, RefreshCw, ChevronRight, MoreHorizontal, FolderSearch, Pencil, FolderInput, Info, FolderHeart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { FileBrowser, FileDropZone, FileTypeIcon } from '@/components/file-browser'
import {
  agentSidePanelOpenMapAtom,
  workspaceFilesVersionAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  agentAttachedDirectoriesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
} from '@/atoms/agent-atoms'
import type { FileEntry } from '@proma/shared'

interface SidePanelProps {
  sessionId: string
  sessionPath: string | null
}

export function SidePanel({ sessionId, sessionPath }: SidePanelProps): React.ReactElement {
  // per-session 侧面板状态（默认打开）
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const setSidePanelOpenMap = useSetAtom(agentSidePanelOpenMapAtom)

  const isOpen = sidePanelOpenMap.get(sessionId) ?? true

  // 动画标志：渲染阶段直接计算，同一会话内 isOpen 变化时启用过渡动画，切换会话时即时显示
  const prevIsOpenRef = React.useRef(isOpen)
  const prevSessionIdRef = React.useRef(sessionId)
  const shouldAnimate = prevSessionIdRef.current === sessionId && prevIsOpenRef.current !== isOpen
  // 在渲染后更新 prev 值，以便下次渲染比较
  React.useEffect(() => {
    prevIsOpenRef.current = isOpen
    prevSessionIdRef.current = sessionId
  })

  const setIsOpen = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setSidePanelOpenMap((prev) => {
      const map = new Map(prev)
      const current = map.get(sessionId) ?? true
      map.set(sessionId, typeof value === 'function' ? value(current) : value)
      return map
    })
  }, [sessionId, setSidePanelOpenMap])

  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const setFilesVersion = useSetAtom(workspaceFilesVersionAtom)
  const hasFileChanges = filesVersion > 0

  // 派生当前工作区 slug（用于 FileDropZone IPC 调用）
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null

  // 附加目录列表（会话级）
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []

  // 附加目录列表（工作区级）
  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const setWsAttachedDirsMap = useSetAtom(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []

  // 加载工作区级附加目录
  React.useEffect(() => {
    if (!workspaceSlug || !currentWorkspaceId) return
    window.electronAPI.getWorkspaceDirectories(workspaceSlug)
      .then((dirs) => {
        setWsAttachedDirsMap((prev) => {
          const map = new Map(prev)
          map.set(currentWorkspaceId, dirs)
          return map
        })
      })
      .catch(console.error)
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  // === 会话级：附加/移除目录 ===

  const attachSessionDir = React.useCallback(async (dirPath: string) => {
    const updated = await window.electronAPI.attachDirectory({ sessionId, directoryPath: dirPath })
    setAttachedDirsMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, updated)
      return map
    })
  }, [sessionId, setAttachedDirsMap])

  const handleAttachFolder = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (result) await attachSessionDir(result.path)
    } catch (error) {
      console.error('[SidePanel] 附加文件夹失败:', error)
    }
  }, [attachSessionDir])

  const handleSessionFoldersDropped = React.useCallback(async (folderPaths: string[]) => {
    for (const dirPath of folderPaths) {
      try { await attachSessionDir(dirPath) } catch (error) {
        console.error('[SidePanel] 拖拽附加文件夹失败:', error)
      }
    }
  }, [attachSessionDir])

  const handleDetachDirectory = React.useCallback(async (dirPath: string) => {
    try {
      const updated = await window.electronAPI.detachDirectory({ sessionId, directoryPath: dirPath })
      setAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) { map.set(sessionId, updated) } else { map.delete(sessionId) }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除附加目录失败:', error)
    }
  }, [sessionId, setAttachedDirsMap])

  // === 工作区级：附加/移除目录 ===

  const attachWorkspaceDir = React.useCallback(async (dirPath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    const updated = await window.electronAPI.attachWorkspaceDirectory({ workspaceSlug, directoryPath: dirPath })
    setWsAttachedDirsMap((prev) => {
      const map = new Map(prev)
      map.set(currentWorkspaceId, updated)
      return map
    })
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  const handleAttachWorkspaceFolder = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (result) await attachWorkspaceDir(result.path)
    } catch (error) {
      console.error('[SidePanel] 附加工作区文件夹失败:', error)
    }
  }, [attachWorkspaceDir])

  const handleWorkspaceFoldersDropped = React.useCallback(async (folderPaths: string[]) => {
    for (const dirPath of folderPaths) {
      try { await attachWorkspaceDir(dirPath) } catch (error) {
        console.error('[SidePanel] 拖拽附加工作区文件夹失败:', error)
      }
    }
  }, [attachWorkspaceDir])

  const handleDetachWorkspaceDirectory = React.useCallback(async (dirPath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    try {
      const updated = await window.electronAPI.detachWorkspaceDirectory({ workspaceSlug, directoryPath: dirPath })
      setWsAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) { map.set(currentWorkspaceId, updated) } else { map.delete(currentWorkspaceId) }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除工作区附加目录失败:', error)
    }
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  // 文件上传完成后递增版本号，触发 FileBrowser 刷新
  const handleFilesUploaded = React.useCallback(() => {
    setFilesVersion((prev) => prev + 1)
  }, [setFilesVersion])

  // 手动刷新文件列表
  const handleRefresh = React.useCallback(() => {
    setFilesVersion((prev) => prev + 1)
  }, [setFilesVersion])

  // 面包屑：显示根路径最后两段
  const breadcrumb = React.useMemo(() => {
    if (!sessionPath) return ''
    const parts = sessionPath.split('/').filter(Boolean)
    return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : sessionPath
  }, [sessionPath])

  // 工作区文件目录路径
  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!workspaceSlug) {
      setWorkspaceFilesPath(null)
      return
    }
    window.electronAPI.getWorkspaceFilesPath(workspaceSlug).then(setWorkspaceFilesPath).catch(() => setWorkspaceFilesPath(null))
  }, [workspaceSlug])

  // 自动打开：文件变化时（仅在有 sessionPath 时）
  const prevFilesVersionRef = React.useRef(filesVersion)
  React.useEffect(() => {
    if (filesVersion > prevFilesVersionRef.current && sessionPath) {
      setIsOpen(true)
    }
    prevFilesVersionRef.current = filesVersion
  }, [filesVersion, sessionPath, setIsOpen])

  return (
    <div
      className={cn(
        'relative h-full flex-shrink-0 overflow-hidden titlebar-drag-region bg-content-area/95 backdrop-blur-xl rounded-2xl shadow-xl',
        shouldAnimate && 'transition-[width] duration-300 ease-in-out',
        isOpen ? 'w-[320px]' : 'w-0',
      )}
    >
      {/* 面板内容 */}
      <div
        className={cn(
          'w-[320px] h-full flex flex-col titlebar-no-drag pt-0.5',
          shouldAnimate && 'transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        >
          {/* 文件浏览内容 */}
          {workspaceSlug ? (
            <div className="flex-1 min-h-0 flex flex-col">
                  {/* ===== 会话文件区（仅当 sessionPath 存在时显示） ===== */}
                  {sessionPath && (
                    <>
                      <div className="flex items-center gap-1 pl-3 pr-2 h-[32px] flex-shrink-0">
                        <FolderOpen className="size-3 text-muted-foreground" />
                        <span className="text-[11px] font-medium text-muted-foreground">会话文件</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="size-3 text-muted-foreground/50 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[200px]">
                            <p>当前会话的专属文件，仅本次对话的 Agent 可以访问</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-[10px] text-muted-foreground/75 truncate flex-1" title={sessionPath}>
                          {breadcrumb}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 flex-shrink-0"
                              onClick={() => window.electronAPI.openFile(sessionPath).catch(console.error)}
                            >
                              <ExternalLink className="size-2.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>在 Finder 中打开</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 flex-shrink-0"
                              onClick={handleRefresh}
                            >
                              <RefreshCw className="size-2.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>刷新文件列表</p>
                          </TooltipContent>
                        </Tooltip>
                        {/* 关闭面板按钮 */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 flex-shrink-0"
                              onClick={() => setIsOpen((prev) => !prev)}
                            >
                              <X className="size-2.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>关闭侧面板</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {/* 会话文件内容区（独立滚动） */}
                      <div className="flex-1 min-h-0 overflow-y-auto">
                        {/* 附加目录列表（可展开目录树） */}
                        {attachedDirs.length > 0 && (
                          <AttachedDirsSection
                            attachedDirs={attachedDirs}
                            onDetach={handleDetachDirectory}
                            refreshVersion={filesVersion}
                          />
                        )}
                        {/* 会话文件浏览器 */}
                        <>
                          {attachedDirs.length > 0 && (
                            <div className="text-[11px] font-medium text-muted-foreground mb-1 px-3 pt-2">工作文件（存储于该工作区目录）</div>
                          )}
                          <FileBrowser rootPath={sessionPath} hideToolbar embedded hideEmpty={attachedDirs.length > 0} />
                        </>
                        {/* 会话文件拖拽上传区域 */}
                        <FileDropZone
                          workspaceSlug={workspaceSlug}
                          sessionId={sessionId}
                          target="session"
                          onFilesUploaded={handleFilesUploaded}
                          onAttachFolder={handleAttachFolder}
                          onFoldersDropped={handleSessionFoldersDropped}
                        />
                      </div>
                      {/* ===== 分隔线 ===== */}
                      <div className="mx-3 my-3 border-t border-muted-foreground/20" />
                    </>
                  )}

                  {/* ===== 顶部关闭按钮（仅在无 sessionPath 时显示，有 sessionPath 时关闭按钮在会话文件区标题栏） ===== */}
                  {!sessionPath && (
                    <div className="flex items-center justify-end px-3 h-[32px] flex-shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 flex-shrink-0"
                            onClick={() => setIsOpen((prev) => !prev)}
                          >
                            <X className="size-2.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>关闭侧面板</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}

                  {/* ===== 工作区文件区 ===== */}
                  <div className="flex-1 min-h-0 flex flex-col mx-2 mb-2">
                    <div className="flex items-center gap-1 px-2 h-[32px] flex-shrink-0">
                      <FolderHeart className="size-3 text-muted-foreground" />
                      <span className="text-[11px] font-medium text-muted-foreground">工作区文件</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 text-muted-foreground/50 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[220px]">
                          <p>工作区内所有会话可访问的文件和文件夹，每个新对话都可以自动读取</p>
                        </TooltipContent>
                      </Tooltip>
                      <div className="flex-1" />
                      {workspaceFilesPath && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 flex-shrink-0"
                              onClick={() => window.electronAPI.openFile(workspaceFilesPath).catch(console.error)}
                            >
                              <ExternalLink className="size-2.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>在 Finder 中打开工作区文件目录</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {/* 工作区文件内容区（独立滚动） */}
                    <div className="flex-1 min-h-0 overflow-y-auto pb-1">
                      {/* 工作区级附加目录 */}
                      {wsAttachedDirs.length > 0 && (
                        <AttachedDirsSection
                          attachedDirs={wsAttachedDirs}
                          onDetach={handleDetachWorkspaceDirectory}
                          refreshVersion={filesVersion}
                        />
                      )}
                      {/* 工作区文件浏览器 */}
                      {workspaceFilesPath && (
                        <>
                          {wsAttachedDirs.length > 0 && (
                            <div className="text-[11px] font-medium text-muted-foreground mb-1 px-3 pt-2">工作文件（存储于该工作区目录）</div>
                          )}
                          <FileBrowser rootPath={workspaceFilesPath} hideToolbar embedded hideEmpty={wsAttachedDirs.length > 0} />
                        </>
                      )}
                      {/* 工作区文件拖拽上传区域 */}
                      <FileDropZone
                        workspaceSlug={workspaceSlug}
                        target="workspace"
                        onFilesUploaded={handleFilesUploaded}
                        onAttachFolder={handleAttachWorkspaceFolder}
                        onFoldersDropped={handleWorkspaceFoldersDropped}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col">
                  {/* 顶部关闭按钮 */}
                  <div className="flex items-center justify-end px-3 h-[32px] flex-shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 flex-shrink-0"
                          onClick={() => setIsOpen((prev) => !prev)}
                        >
                          <X className="size-2.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>关闭侧面板</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                    请选择工作区
                  </div>
                </div>
              )}
        </div>
    </div>
  )
}

// ===== 附加目录容器（管理选中状态） =====

interface AttachedDirsSectionProps {
  attachedDirs: string[]
  onDetach: (dirPath: string) => void
  /** 文件版本号，用于自动刷新已展开的目录 */
  refreshVersion: number
}

/** 附加目录区域：统一管理所有子项的选中状态 */
function AttachedDirsSection({ attachedDirs, onDetach, refreshVersion }: AttachedDirsSectionProps): React.ReactElement {
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set())

  const handleSelect = React.useCallback((path: string, ctrlKey: boolean) => {
    setSelectedPaths((prev) => {
      if (ctrlKey) {
        // Ctrl+点击：切换选中
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      }
      // 普通点击：单选
      return new Set([path])
    })
  }, [])

  return (
    <div className="pt-2.5 pb-1 flex-shrink-0">
      <div className="text-[11px] font-medium text-muted-foreground mb-1 px-3">附加目录（Agent 可以读取并操作此外部文件夹）</div>
      {attachedDirs.map((dir) => (
        <AttachedDirTree
          key={dir}
          dirPath={dir}
          onDetach={() => onDetach(dir)}
          selectedPaths={selectedPaths}
          onSelect={handleSelect}
          refreshVersion={refreshVersion}
        />
      ))}
    </div>
  )
}

// ===== 附加目录树组件 =====

interface AttachedDirTreeProps {
  dirPath: string
  onDetach: () => void
  selectedPaths: Set<string>
  onSelect: (path: string, ctrlKey: boolean) => void
  /** 文件版本号，变化时已展开的目录自动重新加载 */
  refreshVersion: number
}

/** 附加目录根节点：可展开/收起，带移除按钮 */
function AttachedDirTree({ dirPath, onDetach, selectedPaths, onSelect, refreshVersion }: AttachedDirTreeProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [loaded, setLoaded] = React.useState(false)

  const dirName = dirPath.split('/').filter(Boolean).pop() || dirPath

  // 当 refreshVersion 变化时，已展开的目录自动重新加载
  React.useEffect(() => {
    if (expanded && loaded) {
      window.electronAPI.listAttachedDirectory(dirPath)
        .then((items) => setChildren(items))
        .catch((err) => console.error('[AttachedDirTree] 刷新失败:', err))
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = async (): Promise<void> => {
    if (!expanded && !loaded) {
      try {
        const items = await window.electronAPI.listAttachedDirectory(dirPath)
        setChildren(items)
        setLoaded(true)
      } catch (err) {
        console.error('[AttachedDirTree] 加载失败:', err)
      }
    }
    setExpanded(!expanded)
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 pl-2 pr-2 text-sm cursor-pointer hover:bg-accent/50 group mx-2 rounded-lg"
        onClick={toggleExpand}
      >
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        <FileTypeIcon name={dirName} isDirectory isOpen={expanded} />
        <span className="text-xs truncate flex-1" title={dirPath}>
          {dirName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onDetach() }}
        >
          <X className="size-3" />
        </Button>
      </div>
      {expanded && children.length === 0 && loaded && (
        <div className="text-[11px] text-muted-foreground/50 py-1" style={{ paddingLeft: 48 }}>
          空文件夹
        </div>
      )}
      {expanded && children.map((child) => (
        <AttachedDirItem key={child.path} entry={child} depth={1} selectedPaths={selectedPaths} onSelect={onSelect} refreshVersion={refreshVersion} />
      ))}
    </div>
  )
}

interface AttachedDirItemProps {
  entry: FileEntry
  depth: number
  selectedPaths: Set<string>
  onSelect: (path: string, ctrlKey: boolean) => void
  /** 文件版本号，变化时已展开的目录自动重新加载 */
  refreshVersion: number
}

/** 附加目录子项：递归可展开，支持选中 + 三点菜单（含重命名、移动） */
function AttachedDirItem({ entry, depth, selectedPaths, onSelect, refreshVersion }: AttachedDirItemProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [loaded, setLoaded] = React.useState(false)
  // 重命名状态
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(entry.name)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  // 当前显示的名称和路径（重命名后更新）
  const [currentName, setCurrentName] = React.useState(entry.name)
  const [currentPath, setCurrentPath] = React.useState(entry.path)

  const isSelected = selectedPaths.has(currentPath)

  // 当 refreshVersion 变化时，已展开的文件夹自动重新加载子项
  React.useEffect(() => {
    if (expanded && loaded && entry.isDirectory) {
      window.electronAPI.listAttachedDirectory(currentPath)
        .then((items) => setChildren(items))
        .catch((err) => console.error('[AttachedDirItem] 刷新子目录失败:', err))
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = async (): Promise<void> => {
    if (!entry.isDirectory) return
    if (!expanded && !loaded) {
      try {
        const items = await window.electronAPI.listAttachedDirectory(currentPath)
        setChildren(items)
        setLoaded(true)
      } catch (err) {
        console.error('[AttachedDirItem] 加载子目录失败:', err)
      }
    }
    setExpanded(!expanded)
  }

  const handleClick = (e: React.MouseEvent): void => {
    onSelect(currentPath, e.ctrlKey || e.metaKey)
    if (entry.isDirectory) {
      toggleDir()
    }
  }

  const handleDoubleClick = (): void => {
    if (!entry.isDirectory) {
      window.electronAPI.openAttachedFile(currentPath).catch(console.error)
    }
  }

  // 开始重命名
  const startRename = (): void => {
    setRenameValue(currentName)
    setIsRenaming(true)
    // 延迟聚焦，等待 DOM 渲染
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  // 确认重命名
  const confirmRename = async (): Promise<void> => {
    const newName = renameValue.trim()
    if (!newName || newName === currentName) {
      setIsRenaming(false)
      return
    }
    try {
      await window.electronAPI.renameAttachedFile(currentPath, newName)
      // 更新本地显示
      const parentDir = currentPath.substring(0, currentPath.lastIndexOf('/'))
      const newPath = `${parentDir}/${newName}`
      // 更新选中状态中的路径
      onSelect(newPath, false)
      setCurrentName(newName)
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 重命名失败:', err)
    }
    setIsRenaming(false)
  }

  // 取消重命名
  const cancelRename = (): void => {
    setIsRenaming(false)
    setRenameValue(currentName)
  }

  // 移动到文件夹
  const handleMove = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return
      await window.electronAPI.moveAttachedFile(currentPath, result.path)
      // 移动后更新路径
      const newPath = `${result.path}/${currentName}`
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 移动失败:', err)
    }
  }

  const paddingLeft = 8 + depth * 16

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 py-1 pr-2 text-sm cursor-pointer group mx-2 rounded-lg',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
        style={{ paddingLeft }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {entry.isDirectory ? (
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        <FileTypeIcon name={currentName} isDirectory={entry.isDirectory} isOpen={expanded} />

        {/* 名称：正常显示 / 重命名输入框 */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="text-xs flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0.5 outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') cancelRename()
              e.stopPropagation()
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-xs flex-1">{currentName}</span>
        )}

        {/* 三点菜单按钮（始终占位，避免选中时行高跳动） */}
        <div
          className={cn('flex-shrink-0', !(isSelected && !isRenaming) && 'invisible')}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent/70"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            {isSelected && !isRenaming && (
              <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={() => window.electronAPI.showAttachedInFolder(currentPath).catch(console.error)}
                >
                  <FolderSearch />
                  在文件夹中显示
                </DropdownMenuItem>
                {!entry.isDirectory && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => window.electronAPI.openAttachedFile(currentPath).catch(console.error)}
                  >
                    <ExternalLink />
                    打开文件
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={startRename}
                >
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={handleMove}
                >
                  <FolderInput />
                  移动到...
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      </div>
      {expanded && children.length === 0 && loaded && (
        <div
          className="text-[11px] text-muted-foreground/50 py-1"
          style={{ paddingLeft: paddingLeft + 24 }}
        >
          空文件夹
        </div>
      )}
      {expanded && children.map((child) => (
        <AttachedDirItem key={child.path} entry={child} depth={depth + 1} selectedPaths={selectedPaths} onSelect={onSelect} refreshVersion={refreshVersion} />
      ))}
    </>
  )
}
