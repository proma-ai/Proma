/**
 * FileBrowser — 通用文件浏览器面板
 *
 * 显示指定根路径下的文件树，支持：
 * - 文件夹懒加载展开
 * - 点击文件用系统默认应用打开
 * - 右键菜单：打开 / 在 Finder 中打开 / 在文件夹中显示 / 删除
 * - 文件/文件夹删除（带确认对话框）
 * - 自动刷新
 *
 * 注意：使用手动 onContextMenu + 定位弹出菜单而非 Radix ContextMenu，
 * 因为 Radix ContextMenu 在 Electron ScrollArea 内存在右键事件不触发的问题。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Trash2,
  RefreshCw,
  ExternalLink,
  FolderSearch,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { workspaceFilesVersionAtom } from '@/atoms/agent-atoms'
import type { FileEntry } from '@proma/shared'

/** 右键菜单状态 */
interface ContextMenuState {
  x: number
  y: number
  entry: FileEntry
}

interface FileBrowserProps {
  rootPath: string
}

export function FileBrowser({ rootPath }: FileBrowserProps): React.ReactElement {
  const [entries, setEntries] = React.useState<FileEntry[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const filesVersion = useAtomValue(workspaceFilesVersionAtom)

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = React.useState<FileEntry | null>(null)
  // 右键菜单状态
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  /** 加载根目录 */
  const loadRoot = React.useCallback(async () => {
    if (!rootPath) return
    setLoading(true)
    setError(null)
    try {
      const items = await window.electronAPI.listDirectory(rootPath)
      setEntries(items)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
      setError(msg)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [rootPath])

  React.useEffect(() => {
    loadRoot()
  }, [loadRoot, filesVersion])

  // 点击任意位置关闭右键菜单
  React.useEffect(() => {
    if (!contextMenu) return

    const close = (): void => setContextMenu(null)
    // 用 capture 阶段捕获，确保菜单关闭
    window.addEventListener('mousedown', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('scroll', close, true)

    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  /** 右键菜单回调 */
  const handleContextMenu = React.useCallback((e: React.MouseEvent, entry: FileEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  /** 右键菜单操作：打开 */
  const handleMenuOpen = (): void => {
    if (!contextMenu) return
    window.electronAPI.openFile(contextMenu.entry.path).catch(console.error)
    setContextMenu(null)
  }

  /** 右键菜单操作：在文件夹中显示 */
  const handleMenuShowInFolder = (): void => {
    if (!contextMenu) return
    window.electronAPI.showInFolder(contextMenu.entry.path).catch(console.error)
    setContextMenu(null)
  }

  /** 右键菜单操作：删除 */
  const handleMenuDelete = (): void => {
    if (!contextMenu) return
    setDeleteTarget(contextMenu.entry)
    setContextMenu(null)
  }

  /** 删除文件/目录 */
  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    try {
      await window.electronAPI.deleteFile(deleteTarget.path)
      await loadRoot()
    } catch (err) {
      console.error('[FileBrowser] 删除失败:', err)
    }
    setDeleteTarget(null)
  }

  // 显示根路径最后两段作为面包屑
  const breadcrumb = React.useMemo(() => {
    const parts = rootPath.split('/').filter(Boolean)
    return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : rootPath
  }, [rootPath])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-1 px-3 pr-10 h-[48px] border-b flex-shrink-0">
        <span className="text-xs text-muted-foreground truncate flex-1" title={rootPath}>
          {breadcrumb}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={() => window.electronAPI.openFile(rootPath).catch(console.error)}
          title="在 Finder 中打开"
        >
          <ExternalLink className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={loadRoot}
          disabled={loading}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* 文件树 */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {error && (
            <div className="px-3 py-2 text-xs text-destructive">{error}</div>
          )}
          {!error && entries.length === 0 && !loading && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              目录为空
            </div>
          )}
          {entries.map((entry) => (
            <FileTreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              onContextMenu={handleContextMenu}
              onRefresh={loadRoot}
            />
          ))}
        </div>
      </ScrollArea>

      {/* 右键菜单（手动定位弹出层） */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.entry.isDirectory ? (
            <button
              type="button"
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={handleMenuOpen}
            >
              <FolderOpen className="size-3.5 mr-2" />
              在 Finder 中打开
            </button>
          ) : (
            <button
              type="button"
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={handleMenuOpen}
            >
              <ExternalLink className="size-3.5 mr-2" />
              打开
            </button>
          )}
          <button
            type="button"
            className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            onClick={handleMenuShowInFolder}
          >
            <FolderSearch className="size-3.5 mr-2" />
            在文件夹中显示
          </button>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleMenuDelete}
          >
            <Trash2 className="size-3.5 mr-2" />
            删除
          </button>
        </div>
      )}

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <strong>{deleteTarget?.name}</strong> 吗？
              {deleteTarget?.isDirectory && '（包含所有子文件）'}
              此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== FileTreeItem 子组件 =====

interface FileTreeItemProps {
  entry: FileEntry
  depth: number
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
  onRefresh: () => Promise<void>
}

function FileTreeItem({ entry, depth, onContextMenu, onRefresh }: FileTreeItemProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [childrenLoaded, setChildrenLoaded] = React.useState(false)

  /** 展开/收起文件夹 */
  const toggleDir = async (): Promise<void> => {
    if (!entry.isDirectory) return

    if (!expanded && !childrenLoaded) {
      try {
        const items = await window.electronAPI.listDirectory(entry.path)
        setChildren(items)
        setChildrenLoaded(true)
      } catch (err) {
        console.error('[FileTreeItem] 加载子目录失败:', err)
      }
    }

    setExpanded(!expanded)
  }

  /** 点击行为：文件 → 打开，文件夹 → 展开/收起 */
  const handleClick = (): void => {
    if (entry.isDirectory) {
      toggleDir()
    } else {
      window.electronAPI.openFile(entry.path).catch(console.error)
    }
  }

  /** 删除后刷新父目录 */
  const handleRefreshAfterDelete = async (): Promise<void> => {
    if (childrenLoaded) {
      try {
        const items = await window.electronAPI.listDirectory(entry.path)
        setChildren(items)
      } catch {
        await onRefresh()
      }
    }
  }

  const paddingLeft = 8 + depth * 16

  return (
    <>
      <div
        className="flex items-center gap-1 py-1 pr-2 text-sm cursor-pointer hover:bg-accent/50 group"
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry)}
      >
        {/* 展开/收起图标 */}
        {entry.isDirectory ? (
          expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground flex-shrink-0" />
          )
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {/* 文件/文件夹图标 */}
        {entry.isDirectory ? (
          expanded ? (
            <FolderOpen className="size-4 text-amber-500 flex-shrink-0" />
          ) : (
            <Folder className="size-4 text-amber-500 flex-shrink-0" />
          )
        ) : (
          <FileText className="size-4 text-muted-foreground flex-shrink-0" />
        )}

        {/* 文件名 */}
        <span className="truncate text-xs flex-1">{entry.name}</span>
      </div>

      {/* 子项 */}
      {expanded && children.map((child) => (
        <FileTreeItem
          key={child.path}
          entry={child}
          depth={depth + 1}
          onContextMenu={onContextMenu}
          onRefresh={handleRefreshAfterDelete}
        />
      ))}
    </>
  )
}
