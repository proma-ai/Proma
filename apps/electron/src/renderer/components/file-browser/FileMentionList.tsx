/**
 * FileMentionList — @ 引用文件下拉列表
 *
 * 显示按来源分组的文件树，支持键盘导航（上/下/Enter/Escape/`）。
 * 通过 React.useImperativeHandle 暴露 onKeyDown 给 TipTap Suggestion。
 *
 * 分组：
 * - 会话文件（session 工作目录下的文件）
 * - 工作区文件（workspace files + 附加目录下的文件）
 *
 * 交互：
 * - 文件夹初始折叠，Tab 键展开/折叠，→/← 方向键辅助
 * - 任何时候按 Enter 完成 @ 引用（文件或目录均可）
 * - 鼠标单击文件夹：展开/折叠；双击文件夹：选中并插入 @ 引用
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { FileIndexEntry } from '@proma/shared'
import { FileTypeIcon } from './FileTypeIcon'
import { ChevronRight, Folder } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

// ===== Error Boundary =====

class MentionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override render() {
    if (this.state.error) {
      console.error('[FileMentionList] render error:', this.state.error)
      return (
        <div className="rounded-lg border bg-popover p-2 shadow-lg text-[11px] text-muted-foreground">
          无匹配文件
        </div>
      )
    }
    return this.props.children
  }
}

// ===== 树形结构类型 =====

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  source: 'session' | 'workspace'
  depth: number
  children: FileTreeNode[]
  expanded: boolean
}

// ===== Props & Ref =====

export interface FileMentionListProps {
  sessionEntries: FileIndexEntry[]
  workspaceEntries: FileIndexEntry[]
  onSelect: (item: { name: string; path: string; type: 'file' | 'dir' }) => void
}

export interface FileMentionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

// ===== 工具函数 =====

/** 从扁平条目列表构建树 */
function buildTree(entries: FileIndexEntry[]): FileTreeNode[] {
  const pathMap = new Map<string, FileTreeNode>()
  const roots: FileTreeNode[] = []

  for (const entry of entries) {
    pathMap.set(entry.path, {
      name: entry.name,
      path: entry.path,
      type: entry.type,
      source: entry.source,
      depth: 0,
      children: [],
      expanded: false,
    })
  }

  for (const entry of entries) {
    const node = pathMap.get(entry.path)!
    const lastSlash = entry.path.lastIndexOf('/')
    const parentPath = lastSlash === -1 ? '' : entry.path.slice(0, lastSlash)

    if (parentPath && pathMap.has(parentPath)) {
      pathMap.get(parentPath)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // 递归排序：目录在前、文件在后，按名称字母序
  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      return a.name.localeCompare(b.name)
    })
  }
  for (const [, node] of pathMap) sortNodes(node.children)
  sortNodes(roots)

  // 设置深度
  function setDepth(nodes: FileTreeNode[], depth: number) {
    for (const node of nodes) {
      node.depth = depth
      setDepth(node.children, depth + 1)
    }
  }
  setDepth(roots, 0)

  return roots
}

/** 将树扁平化为可见项列表（仅展开的目录显示子节点） */
function flattenVisible(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = []
  function walk(nodes: FileTreeNode[]) {
    for (const node of nodes) {
      result.push(node)
      if (node.type === 'dir' && node.expanded) {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return result
}

// ===== 组件 =====

export const FileMentionList = React.forwardRef<FileMentionRef, FileMentionListProps>(
  function FileMentionList({ sessionEntries, workspaceEntries, onSelect }, ref) {
    // 构建树（仅在条目变化时重建）
    const sessionTree = React.useMemo(
      () => buildTree(sessionEntries),
      [sessionEntries],
    )
    const workspaceTree = React.useMemo(
      () => buildTree(workspaceEntries),
      [workspaceEntries],
    )

    // 折叠/展开状态（用 expandedPaths Set 管理）
    const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(new Set())

    // 将 expanded 状态注入树节点
    const sessionTreeWithState = React.useMemo(() => {
      function inject(nodes: FileTreeNode[]): FileTreeNode[] {
        return nodes.map((n) => ({
          ...n,
          expanded: expandedPaths.has(n.path),
          children: inject(n.children),
        }))
      }
      return inject(sessionTree)
    }, [sessionTree, expandedPaths])

    const workspaceTreeWithState = React.useMemo(() => {
      function inject(nodes: FileTreeNode[]): FileTreeNode[] {
        return nodes.map((n) => ({
          ...n,
          expanded: expandedPaths.has(n.path),
          children: inject(n.children),
        }))
      }
      return inject(workspaceTree)
    }, [workspaceTree, expandedPaths])

    // 可见项（用于键盘导航和渲染）
    const sessionVisible = React.useMemo(
      () => flattenVisible(sessionTreeWithState),
      [sessionTreeWithState],
    )
    const workspaceVisible = React.useMemo(
      () => flattenVisible(workspaceTreeWithState),
      [workspaceTreeWithState],
    )

    // 选中索引
    const totalItems = sessionVisible.length + workspaceVisible.length
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const containerRef = React.useRef<HTMLDivElement>(null)

    // 条目变化或展开状态变化时重置/修正索引
    React.useEffect(() => {
      setSelectedIndex((prev) => (totalItems > 0 ? Math.min(prev, totalItems - 1) : 0))
    }, [sessionEntries, workspaceEntries, totalItems])

    // 滚动选中项到可见区域
    React.useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const items = container.querySelectorAll('[data-mention-item]')
      const target = items[selectedIndex] as HTMLElement | undefined
      target?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex, totalItems])

    // 获取指定索引对应的实际节点（跨 session 和 workspace 列表）
    function getNodeAt(index: number): FileTreeNode | null {
      if (index < sessionVisible.length) return sessionVisible[index] ?? null
      const wsIdx = index - sessionVisible.length
      return workspaceVisible[wsIdx] ?? null
    }

    function toggleExpand(path: string) {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      })
    }

    const handleSelect = React.useCallback(
      (node: FileTreeNode) => {
        onSelect({ name: node.name, path: node.path, type: node.type })
      },
      [onSelect],
    )

    const handleSetIndex = React.useCallback(
      (index: number) => {
        setSelectedIndex(index)
      },
      [],
    )

    // 暴露键盘处理给 TipTap
    React.useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex((prev) => (prev <= 0 ? totalItems - 1 : prev - 1))
          return true
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex((prev) => (prev >= totalItems - 1 ? 0 : prev + 1))
          return true
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          const node = getNodeAt(selectedIndex)
          if (node && node.type === 'dir' && node.children.length > 0) {
            toggleExpand(node.path)
          }
          return true
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          const node = getNodeAt(selectedIndex)
          if (node && node.type === 'dir' && node.children.length > 0 && !node.expanded) {
            toggleExpand(node.path)
          }
          return true
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          const node = getNodeAt(selectedIndex)
          if (node && node.type === 'dir' && node.expanded) {
            toggleExpand(node.path)
          }
          return true
        }
        if (event.key === 'Enter') {
          if (totalItems === 0) return false
          event.preventDefault()
          const node = getNodeAt(selectedIndex)
          if (node) handleSelect(node)
          return true
        }
        if (event.key === 'Escape') {
          return true
        }
        return false
      },
    }))

    const hasSession = sessionEntries.length > 0
    const hasWorkspace = workspaceEntries.length > 0
    const hasResults = hasSession || hasWorkspace

    // 无匹配结果
    if (!hasResults) {
      return (
        <div className="rounded-lg border bg-popover p-2 shadow-lg text-[11px] text-muted-foreground">
          无匹配文件
        </div>
      )
    }

    return (
      <TooltipProvider>
        <MentionErrorBoundary>
      <div
        ref={containerRef}
        className="rounded-lg border bg-popover shadow-lg overflow-y-auto max-h-[360px] min-w-[260px]"
      >
        {/* 会话文件 */}
        {hasSession && (
          <FileSection
            label="会话文件"
            tree={sessionTreeWithState}
            selectedIndex={selectedIndex}
            baseIndex={0}
            onSelect={handleSelect}
            onToggle={toggleExpand}
            setSelectedIndex={handleSetIndex}
          />
        )}

        {/* 工作区文件 */}
        {hasWorkspace && (
          <FileSection
            label="工作区文件"
            tree={workspaceTreeWithState}
            selectedIndex={selectedIndex}
            baseIndex={sessionVisible.length}
            onSelect={handleSelect}
            onToggle={toggleExpand}
            setSelectedIndex={handleSetIndex}
          />
        )}
      </div>
      </MentionErrorBoundary>
      </TooltipProvider>
    )
  },
)

// ===== 子组件 =====

/** 分组区域（会话文件 / 工作区文件） */
function FileSection({
  label,
  tree,
  selectedIndex,
  baseIndex,
  onSelect,
  onToggle,
  setSelectedIndex,
}: {
  label: string
  tree: FileTreeNode[]
  selectedIndex: number
  baseIndex: number
  onSelect: (node: FileTreeNode) => void
  onToggle: (path: string) => void
  setSelectedIndex: (index: number) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-primary/10 text-primary border-b border-border/50">
        <Folder className="size-3" />
        <span>{label}</span>
      </div>
      <TreeNodeList
        nodes={tree}
        selectedIndex={selectedIndex}
        baseIndex={baseIndex}
        onSelect={onSelect}
        onToggle={onToggle}
        setSelectedIndex={setSelectedIndex}
      />
    </div>
  )
}

/** 树节点递归列表 — 展开的目录会递归渲染子节点 */
function TreeNodeList({
  nodes,
  selectedIndex,
  baseIndex,
  onSelect,
  onToggle,
  setSelectedIndex,
}: {
  nodes: FileTreeNode[]
  selectedIndex: number
  baseIndex: number
  onSelect: (node: FileTreeNode) => void
  onToggle: (path: string) => void
  setSelectedIndex: (index: number) => void
}) {
  let offset = 0

  // 双击检测：单击目录时延迟触发 toggle，等待可能的双击
  const clickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    }
  }, [])

  function handleDirClick(node: FileTreeNode) {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    clickTimerRef.current = setTimeout(() => {
      onToggle(node.path)
      clickTimerRef.current = null
    }, 180)
  }

  function handleDirDoubleClick(node: FileTreeNode) {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    onSelect(node)
  }

  function renderNode(node: FileTreeNode): React.ReactElement {
    const idx = baseIndex + offset
    const isSelected = idx === selectedIndex
    const paddingLeft = 8 + node.depth * 16
    offset++

    return (
      <React.Fragment key={node.path}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
          type="button"
          data-mention-item=""
          className={cn(
            'w-full flex items-center gap-1.5 px-2.5 py-1 text-left text-xs transition-colors',
            isSelected
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50',
          )}
          style={{ paddingLeft }}
          onClick={() => {
            setSelectedIndex(idx)
            if (node.type === 'dir') {
              handleDirClick(node)
            } else {
              onSelect(node)
            }
          }}
          onDoubleClick={() => {
            if (node.type === 'dir') {
              handleDirDoubleClick(node)
            }
          }}
        >
          {/* 目录展开/折叠箭头 */}
          {node.type === 'dir' && node.children.length > 0 ? (
            <ChevronRight
              className={cn(
                'size-3 shrink-0 text-muted-foreground transition-transform duration-150',
                node.expanded && 'rotate-90',
              )}
            />
          ) : node.type === 'dir' ? (
            <span className="w-3 shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}

          {/* 文件/目录图标 */}
          <FileTypeIcon
            name={node.name}
            isDirectory={node.type === 'dir'}
            isOpen={node.type === 'dir' && node.expanded}
            size={12}
          />

          {/* 名称 */}
          <span className="truncate flex-1">{node.name}</span>

          {/* 路径（当路径不等于文件名时显示） */}
          {node.path !== node.name && (
            <span className="text-[10px] text-muted-foreground/60 truncate max-w-[140px] shrink-[2]">
              {node.path}
            </span>
          )}

          {/* 选中文件夹时的快捷键提示 */}
          {isSelected && node.type === 'dir' && node.children.length > 0 && !node.expanded && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0 bg-muted/50 rounded px-1 py-px">
              Tab 展开
            </span>
          )}
          {isSelected && node.type === 'dir' && node.children.length > 0 && node.expanded && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0 bg-muted/50 rounded px-1 py-px">
              Tab 折叠
            </span>
          )}
        </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="z-[10000] max-w-xs break-all">
            <p>{node.path}</p>
          </TooltipContent>
        </Tooltip>
        {/* 展开状态下递归渲染子节点 */}
        {node.type === 'dir' && node.expanded && node.children.length > 0 &&
          node.children.map((child) => renderNode(child))
        }
      </React.Fragment>
    )
  }

  return <>{nodes.map((node) => renderNode(node))}</>
}
