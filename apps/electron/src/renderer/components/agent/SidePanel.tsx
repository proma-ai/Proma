/**
 * SidePanel — Agent 侧面板容器
 *
 * 包含 Team Activity 和 File Browser 两个 Tab。
 * 面板可自动打开（检测到 Team/Task 活动或文件变化）
 * 或由用户手动切换。
 *
 * 切换按钮在面板关闭时显示活动指示点。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { PanelRight, X, Users, FolderOpen, ExternalLink, RefreshCw, ChevronRight, Folder, FileText, MoreHorizontal, FolderSearch, Pencil, FolderInput } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { FileBrowser, FileDropZone } from '@/components/file-browser'
import { TeamActivityPanel } from './TeamActivityPanel'
import {
  agentSidePanelOpenMapAtom,
  agentSidePanelTabMapAtom,
  agentStreamingStatesAtom,
  cachedTeamActivitiesAtom,
  buildTeamActivityEntries,
  workspaceFilesVersionAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  agentAttachedDirectoriesMapAtom,
} from '@/atoms/agent-atoms'
import type { SidePanelTab } from '@/atoms/agent-atoms'
import type { FileEntry } from '@proma/shared'

interface SidePanelProps {
  sessionId: string
  sessionPath: string | null
}

export function SidePanel({ sessionId, sessionPath }: SidePanelProps): React.ReactElement {
  // per-session 侧面板状态
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const setSidePanelOpenMap = useSetAtom(agentSidePanelOpenMapAtom)
  const sidePanelTabMap = useAtomValue(agentSidePanelTabMapAtom)
  const setSidePanelTabMap = useSetAtom(agentSidePanelTabMapAtom)

  const isOpen = sidePanelOpenMap.get(sessionId) ?? false
  const activeTab = sidePanelTabMap.get(sessionId) ?? 'team'

  const setIsOpen = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setSidePanelOpenMap((prev) => {
      const map = new Map(prev)
      const current = map.get(sessionId) ?? false
      map.set(sessionId, typeof value === 'function' ? value(current) : value)
      return map
    })
  }, [sessionId, setSidePanelOpenMap])

  const setActiveTab = React.useCallback((tab: SidePanelTab) => {
    setSidePanelTabMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, tab)
      return map
    })
  }, [sessionId, setSidePanelTabMap])

  // 直接用 sessionId 计算 team 活动（不依赖 currentAgentSessionIdAtom）
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const cachedActivities = useAtomValue(cachedTeamActivitiesAtom)

  const hasTeamActivity = React.useMemo(() => {
    const state = streamingStates.get(sessionId)
    if (state) {
      return state.toolActivities.some(
        (a) => a.toolName === 'Task' || a.toolName === 'Agent'
      )
    }
    const cached = cachedActivities.get(sessionId)
    return cached !== undefined && cached.length > 0
  }, [sessionId, streamingStates, cachedActivities])

  const runningCount = React.useMemo(() => {
    const state = streamingStates.get(sessionId)
    if (state && state.toolActivities.length > 0) {
      const entries = buildTeamActivityEntries(state.toolActivities)
      return entries.filter((e) => e.status === 'running' || e.status === 'backgrounded').length
    }
    const cached = cachedActivities.get(sessionId)
    if (cached) {
      return cached.filter((e) => e.status === 'running' || e.status === 'backgrounded').length
    }
    return 0
  }, [sessionId, streamingStates, cachedActivities])

  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const setFilesVersion = useSetAtom(workspaceFilesVersionAtom)
  const hasFileChanges = filesVersion > 0

  // 派生当前工作区 slug（用于 FileDropZone IPC 调用）
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null

  // 附加目录列表
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []

  const handleAttachFolder = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      const updated = await window.electronAPI.attachDirectory({
        sessionId,
        directoryPath: result.path,
      })
      setAttachedDirsMap((prev) => {
        const map = new Map(prev)
        map.set(sessionId, updated)
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 附加文件夹失败:', error)
    }
  }, [sessionId, setAttachedDirsMap])

  const handleDetachDirectory = React.useCallback(async (dirPath: string) => {
    try {
      const updated = await window.electronAPI.detachDirectory({
        sessionId,
        directoryPath: dirPath,
      })
      setAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) {
          map.set(sessionId, updated)
        } else {
          map.delete(sessionId)
        }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除附加目录失败:', error)
    }
  }, [sessionId, setAttachedDirsMap])

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

  // 自动打开：文件变化时（仅在有 sessionPath 时）
  const prevFilesVersionRef = React.useRef(filesVersion)
  React.useEffect(() => {
    if (filesVersion > prevFilesVersionRef.current && sessionPath) {
      setIsOpen(true)
      // 仅在当前无 team 活动时切换到文件 tab
      if (!hasTeamActivity) {
        setActiveTab('files')
      }
    }
    prevFilesVersionRef.current = filesVersion
  }, [filesVersion, sessionPath, hasTeamActivity, setIsOpen, setActiveTab])

  // 面板是否可显示内容（需要有 sessionPath 或 team 活动）
  const hasContent = sessionPath || hasTeamActivity || attachedDirs.length > 0

  return (
    <div
      className={cn(
        'relative flex-shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden titlebar-drag-region',
        hasContent && isOpen ? 'w-[320px] border-l' : 'w-10',
      )}
    >
      {/* 切换按钮 — 始终固定在右上角 */}
      {hasContent && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2.5 top-2.5 z-10 h-7 w-7 titlebar-no-drag"
              onClick={() => setIsOpen((prev) => !prev)}
            >
              <PanelRight
                className={cn(
                  'size-3.5 absolute transition-all duration-200',
                  isOpen ? 'opacity-0 rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100',
                )}
              />
              <X
                className={cn(
                  'size-3.5 absolute transition-all duration-200',
                  isOpen ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-75',
                )}
              />
              {/* 活动指示点（面板关闭时显示） */}
              {!isOpen && (hasTeamActivity || hasFileChanges) && (
                <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary animate-pulse" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>{isOpen ? '关闭侧面板' : '打开侧面板'}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* 面板内容 */}
      {hasContent && (
        <div
          className={cn(
            'w-[320px] h-full flex flex-col transition-opacity duration-300 titlebar-no-drag',
            isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        >
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as SidePanelTab)}
            className="flex flex-col h-full"
          >
            {/* Tab 切换栏 */}
            <div className="flex items-center gap-1 px-2 pr-10 h-[48px] border-b flex-shrink-0">
              <TabsList className="h-8 bg-muted/50">
                <TabsTrigger value="team" className="text-xs h-7 px-3 gap-1.5">
                  <Users className="size-3" />
                  Team
                  {runningCount > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-primary text-primary-foreground leading-none">
                      {runningCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="files" className="text-xs h-7 px-3 gap-1.5">
                  <FolderOpen className="size-3" />
                  文件
                  {hasFileChanges && (
                    <span className="ml-0.5 size-1.5 rounded-full bg-primary" />
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Team Activity Tab */}
            <TabsContent value="team" className="flex-1 overflow-hidden m-0 data-[state=active]:flex data-[state=active]:flex-col">
              <TeamActivityPanel sessionId={sessionId} />
            </TabsContent>

            {/* File Browser Tab */}
            <TabsContent value="files" className="flex-1 overflow-hidden m-0 data-[state=active]:flex data-[state=active]:flex-col">
              {sessionPath && workspaceSlug ? (
                <>
                  {/* 工具栏：工作区目录标签 + 路径 + 按钮 */}
                  <div className="flex items-center gap-1 px-3 h-[36px] border-b flex-shrink-0">
                    <span className="text-[11px] font-medium text-muted-foreground shrink-0">工作区目录</span>
                    <span className="text-[11px] text-muted-foreground/60 truncate flex-1" title={sessionPath}>
                      {breadcrumb}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={() => window.electronAPI.openFile(sessionPath).catch(console.error)}
                        >
                          <ExternalLink className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>在 Finder 中打开工作区文件夹</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={handleRefresh}
                        >
                          <RefreshCw className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>刷新文件列表</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {/* 可滚动内容区：附加目录 + 文件浏览器 + 拖拽上传 */}
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {/* 附加目录列表（可展开目录树） */}
                    {attachedDirs.length > 0 && (
                      <AttachedDirsSection
                        attachedDirs={attachedDirs}
                        onDetach={handleDetachDirectory}
                        refreshVersion={filesVersion}
                      />
                    )}
                    {/* 文件浏览器（嵌入模式，不自带滚动） */}
                    <FileBrowser rootPath={sessionPath} hideToolbar embedded />
                    {/* 文件拖拽上传区域 */}
                    <FileDropZone
                      workspaceSlug={workspaceSlug}
                      sessionId={sessionId}
                      onFilesUploaded={handleFilesUploaded}
                      onAttachFolder={handleAttachFolder}
                    />
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  请选择工作区
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
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
      <div className="text-[11px] font-medium text-muted-foreground mb-1 px-3">附加目录（Agent 可以读取并操作此文件夹）</div>
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
        className="flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-accent/50 group"
        onClick={toggleExpand}
      >
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        {expanded ? (
          <FolderOpen className="size-4 text-amber-500 flex-shrink-0" />
        ) : (
          <Folder className="size-4 text-amber-500 flex-shrink-0" />
        )}
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
          'flex items-center gap-1 py-1 pr-2 text-sm cursor-pointer group',
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
        {entry.isDirectory ? (
          expanded ? (
            <FolderOpen className="size-4 text-amber-500 flex-shrink-0" />
          ) : (
            <Folder className="size-4 text-amber-500 flex-shrink-0" />
          )
        ) : (
          <FileText className="size-4 text-muted-foreground flex-shrink-0" />
        )}

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

        {/* 三点菜单按钮 */}
        {isSelected && !isRenaming && (
          <div
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
            </DropdownMenu>
          </div>
        )}
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
