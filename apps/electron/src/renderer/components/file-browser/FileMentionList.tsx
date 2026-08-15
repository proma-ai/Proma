/**
 * FileMentionList — @ 引用文件下拉列表
 *
 * 显示当前会话可见的统一文件树，支持键盘导航（上/下/Enter/Escape/`）。
 * 通过 React.useImperativeHandle 暴露 onKeyDown 给 TipTap Suggestion。
 *
 * 会话文件通过 badge 标记；项目文件和会话文件不再分区展示。
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
import { ChevronRight } from 'lucide-react'
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

export interface FileTreeNode {
  name: string
  /** 保留原始相对路径，供 @ 引用插入。 */
  path: string
  /** 用 POSIX 分隔符归一化的相对路径，仅用于构建树和稳定 key。 */
  treePath: string
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
  onSelect: (item: Pick<FileIndexEntry, 'name' | 'path' | 'type' | 'source'>) => void
  /** 作为统一命令菜单子层时，← 可返回命令根层。 */
  onBack?: () => void
  /** 嵌入另一个弹层时，移除自身的卡片容器样式。 */
  embedded?: boolean
}

export interface FileMentionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

// ===== 工具函数 =====

function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function getTreeNodeKey(node: Pick<FileTreeNode, 'source' | 'treePath'>): string {
  return `${node.source}\u0000${node.treePath}`
}

/** 从两种来源的扁平条目构建一个连续树，来源只用于权限语义和 badge。 */
export function buildFileMentionTree(entries: FileIndexEntry[]): FileTreeNode[] {
  const pathMap = new Map<string, FileTreeNode>()
  const roots: FileTreeNode[] = []

  for (const entry of entries) {
    const treePath = normalizeTreePath(entry.path)
    pathMap.set(getTreeNodeKey({ source: entry.source, treePath }), {
      name: entry.name,
      path: entry.path,
      treePath,
      type: entry.type,
      source: entry.source,
      depth: 0,
      children: [],
      expanded: false,
    })
  }

  for (const node of pathMap.values()) {
    const lastSlash = node.treePath.lastIndexOf('/')
    const parentTreePath = lastSlash === -1 ? '' : node.treePath.slice(0, lastSlash)
    const parent = parentTreePath
      ? pathMap.get(getTreeNodeKey({ source: node.source, treePath: parentTreePath }))
      : undefined

    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // 递归排序：目录在前、文件在后，路径来源只在完全同名时稳定顺序。
  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      const byName = a.name.localeCompare(b.name)
      if (byName !== 0) return byName
      if (a.source !== b.source) return a.source === 'workspace' ? -1 : 1
      return a.treePath.localeCompare(b.treePath)
    })
  }
  for (const node of pathMap.values()) sortNodes(node.children)
  sortNodes(roots)

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

/** 会话与项目可有相同相对路径，展开状态必须保留来源维度。 */
function getTreeNodeStateKey(node: Pick<FileTreeNode, 'source' | 'treePath'>): string {
  return getTreeNodeKey(node)
}

// ===== 组件 =====

export const FileMentionList = React.forwardRef<FileMentionRef, FileMentionListProps>(
  function FileMentionList({ sessionEntries, workspaceEntries, onSelect, onBack, embedded = false }, ref) {
    // 构建一棵连续树；项目与会话来源只通过 badge 区分，不形成两个列表。
    const tree = React.useMemo(
      () => buildFileMentionTree([...workspaceEntries, ...sessionEntries]),
      [sessionEntries, workspaceEntries],
    )

    const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(new Set())

    const treeWithState = React.useMemo(() => {
      function inject(nodes: FileTreeNode[]): FileTreeNode[] {
        return nodes.map((node) => ({
          ...node,
          expanded: expandedPaths.has(getTreeNodeStateKey(node)),
          children: inject(node.children),
        }))
      }
      return inject(tree)
    }, [tree, expandedPaths])

    const visibleNodes = React.useMemo(
      () => flattenVisible(treeWithState),
      [treeWithState],
    )

    const totalItems = visibleNodes.length
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      setSelectedIndex((prev) => (totalItems > 0 ? Math.min(prev, totalItems - 1) : 0))
    }, [sessionEntries, workspaceEntries, totalItems])

    React.useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const items = container.querySelectorAll('[data-mention-item]')
      const target = items[selectedIndex] as HTMLElement | undefined
      target?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex, totalItems])

    function getNodeAt(index: number): FileTreeNode | null {
      return visibleNodes[index] ?? null
    }

    function toggleExpand(node: Pick<FileTreeNode, 'source' | 'treePath'>) {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        const key = getTreeNodeStateKey(node)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
    }

    const handleSelect = React.useCallback(
      (node: FileTreeNode) => {
        onSelect({ name: node.name, path: node.path, type: node.type, source: node.source })
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
            toggleExpand(node)
          }
          return true
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          const node = getNodeAt(selectedIndex)
          if (node && node.type === 'dir' && node.children.length > 0 && !node.expanded) {
            toggleExpand(node)
          }
          return true
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          const node = getNodeAt(selectedIndex)
          if (node && node.type === 'dir' && node.expanded) {
            toggleExpand(node)
          } else {
            onBack?.()
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
        // Escape 不在此处理：返回 false 交还给 TipTap suggestion 插件内置的
        // Escape 分支，由它调用 onExit（触发 cleanup 移除弹窗）并 dispatchExit
        // 重置插件 active 状态。若在此 return true，插件会认为已处理而跳过退出，
        // 导致弹窗无法关闭，必须靠输入空格让 suggestion 匹配失效才会消失。
        return false
      },
    }))

    const hasResults = totalItems > 0

    // 无匹配结果
    if (!hasResults) {
      return (
        <div className={cn(!embedded && 'rounded-lg border bg-popover shadow-lg', 'overflow-hidden min-w-[260px]')}>
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-medium bg-primary/10 text-primary border-b border-border/50">
            <span>文件</span>
            <span className="font-normal text-muted-foreground">Esc 关闭 · Enter 选中</span>
          </div>
          <div className="p-2 text-[11px] text-muted-foreground">无匹配文件</div>
        </div>
      )
    }

    return (
      <TooltipProvider disableHoverableContent>
        <MentionErrorBoundary>
      <div
        ref={containerRef}
        className={cn(
          !embedded && 'rounded-lg border bg-popover shadow-lg',
          embedded ? 'max-h-none min-w-0' : 'max-h-[360px] min-w-[260px]',
          'overflow-y-auto',
        )}
      >
        <div className="flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-primary/10 text-primary border-b border-border/50">
          <span>文件</span>
          <span className="ml-auto font-normal text-muted-foreground">Esc 关闭 · Enter 选中</span>
        </div>
        <TreeNodeList
          nodes={treeWithState}
          selectedIndex={selectedIndex}
          baseIndex={0}
          onSelect={handleSelect}
          onToggle={toggleExpand}
          setSelectedIndex={handleSetIndex}
        />
      </div>
      </MentionErrorBoundary>
      </TooltipProvider>
    )
  },
)

// ===== 子组件 =====

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
  onToggle: (node: FileTreeNode) => void
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
      onToggle(node)
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
      <React.Fragment key={getTreeNodeKey(node)}>
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
          // 用 mousedown 而非 click：异步搜索结果重渲染会替换 button 节点，
          // 导致 mousedown/mouseup 不在同一节点、click 不派发而漏选；
          // preventDefault 阻止按钮抢焦点，避免编辑器 blur 触发弹窗关闭竞态。
          onMouseDown={(e) => {
            e.preventDefault()
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
          {node.source === 'session' && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground shrink-0">会话文件</span>
          )}

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
