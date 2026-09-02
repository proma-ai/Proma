/**
 * CanvasView — JSON Canvas 自由画布
 *
 * 采用 JSON Canvas 开源格式（github.com/obsidianmd/jsoncanvas），与 Obsidian Canvas 互通。
 * 作为右侧工作区的会话画布 Tab；内容持久化为 session 专属画布文件，
 * 自动保存由 sessionCanvas atoms + IPC（saveSessionCanvas）统一管理。
 *
 * 交互方案对齐 Figma/Miro：
 * - 空白双击 → 新建节点并进入编辑
 * - 空白拖拽 → 框选；Shift 拖拽 → 追加框选
 * - 空格+拖拽 / 中键拖拽 → 平移画布
 * - 滚轮 → 平移；⌘/Ctrl+滚轮（含触控板捏合）→ 缩放
 * - 节点 hover 显示四边锚点，从锚点拖出 → 连线到目标节点
 * - 双击节点 / 连线标签 → 编辑文字
 * - Delete/Backspace → 删除选中；⌘Z / ⌘⇧Z → 撤销重做；⌘A → 全选
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { LayoutGrid, Crosshair, Undo2, Redo2, Group, Upload, Mic, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  sessionCanvasContentsAtom,
  sessionCanvasLoadedAtom,
} from '@/atoms/tab-atoms'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  COLOR_PRESETS,
  NEW_NODE_WIDTH,
  NEW_NODE_HEIGHT,
  buildClusterMarkdown,
  computeEdgeBows,
  computeEdgePath,
  computeSnapGuides,
  extractCluster,
  generateId,
  getSidePoint,
  hitTestNode,
  inferSide,
  makeGroupForSelection,
  nearestSide,
  normalizeRect,
  parseCanvas,
  rectsIntersect,
  runForceLayout,
  screenToCanvas,
  serializeCanvas,
  type CanvasClipboard,
  type CanvasEdge,
  type CanvasNode,
  type GuideLine,
  type NodeSide,
  type ViewState,
} from './canvas-utils'

/** 今日 YYMMDD，作为导出默认名 */
function todayStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 异步加载 session canvas 文件内容 */
async function loadSessionCanvasContent(sessionId: string): Promise<string | null> {
  try {
    const result = await window.electronAPI.loadSessionCanvas?.(sessionId)
    return result ?? null
  } catch {
    return null
  }
}

const ALL_SIDES: NodeSide[] = ['top', 'right', 'bottom', 'left']
const HISTORY_LIMIT = 80

export interface CanvasViewProps {
  /** 画布归属的 Agent 会话；内容持久化为该会话的专属画布 */
  sessionId: string
  /** 可选的关闭回调；右侧工作区 Tab 场景由 Tab 自带的关闭按钮承载，不传即可 */
  onClose?: () => void
}

export function CanvasView({
  sessionId,
  onClose,
}: CanvasViewProps): React.ReactElement {
  // Session 画布 atoms
  const [sessionContents, setSessionContents] = useAtom(sessionCanvasContentsAtom)
  const [sessionLoadedMap, setSessionLoadedMap] = useAtom(sessionCanvasLoadedAtom)
  const sessionLoaded = sessionLoadedMap.get(sessionId) ?? false

  const content = sessionContents.get(sessionId) ?? ''
  const loaded = sessionLoaded

  const setContent = React.useCallback(
    (val: string): void => {
      setSessionContents((prev) => {
        const next = new Map(prev)
        next.set(sessionId, val)
        return next
      })
    },
    [sessionId, setSessionContents],
  )

  // Session canvas 的初始加载
  React.useEffect(() => {
    if (sessionLoadedMap.get(sessionId)) return // 已加载

    // 从文件加载，加载完成后才标记 loaded=true
    loadSessionCanvasContent(sessionId).then((json) => {
      if (json !== null && json !== '') {
        setSessionContents((prev) => {
          const next = new Map(prev)
          next.set(sessionId, json)
          return next
        })
      }
      setSessionLoadedMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, true)
        return next
      })
    }).catch((err) => {
      console.error('[Canvas] session canvas 加载失败:', err)
      setSessionLoadedMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, true)
        return next
      })
    })
  }, [sessionId, sessionLoadedMap, setSessionContents, setSessionLoadedMap])

  // ===== 自动保存：内容变化防抖写盘；卸载与 beforeunload 时同步兑底 =====
  // 旧实现的缺口：session 画布只加载不保存，重启即丢。现在由组件自身负责持久化，
  // 加载完成（loaded）后才允许写盘，避免把空内容覆盖到磁盘上的真实画布。
  const latestContentRef = React.useRef('')
  React.useEffect(() => { latestContentRef.current = content }, [content])
  const loadedRef = React.useRef(false)
  React.useEffect(() => { loadedRef.current = loaded }, [loaded])

  React.useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      const json = latestContentRef.current
      if (!json) return
      window.electronAPI.saveSessionCanvas?.(sessionId, json).catch((err) => {
        console.error('[Canvas] session canvas 保存失败:', err)
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [content, loaded, sessionId])

  React.useEffect(() => () => {
    // Tab 关闭/切换卸载时同步兑底，避免防抖窗口内的最后一段编辑丢失
    if (!loadedRef.current) return
    const json = latestContentRef.current
    if (json) window.electronAPI.saveSessionCanvasSync?.(sessionId, json)
  }, [sessionId])

  React.useEffect(() => {
    const flushOnUnload = (): void => {
      if (!loadedRef.current) return
      const json = latestContentRef.current
      if (json) window.electronAPI.saveSessionCanvasSync?.(sessionId, json)
    }
    window.addEventListener('beforeunload', flushOnUnload)
    return () => window.removeEventListener('beforeunload', flushOnUnload)
  }, [sessionId])

  const [nodes, setNodes] = React.useState<CanvasNode[]>([])
  const [edges, setEdges] = React.useState<CanvasEdge[]>([])
  const [view, setView] = React.useState<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 })
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [editingNodeId, setEditingNodeId] = React.useState<string | null>(null)
  const [editingEdgeId, setEditingEdgeId] = React.useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null)
  const [marquee, setMarquee] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [pendingEdge, setPendingEdge] = React.useState<
    { fromNode: string; fromSide: NodeSide; toX: number; toY: number } | null
  >(null)
  const [spaceDown, setSpaceDown] = React.useState(false)
  const [canUndo, setCanUndo] = React.useState(false)
  const [canRedo, setCanRedo] = React.useState(false)
  const [exportOpen, setExportOpen] = React.useState(false)
  const [activeGuides, setActiveGuides] = React.useState<GuideLine[]>([])

  // 内部剪贴板（不与系统剪贴板交互，纯内存）
  const clipboardRef = React.useRef<CanvasClipboard | null>(null)
  // 最后一次鼠标位置（画布坐标），用于 paste 贴近鼠标位置
  const lastMouseCanvasRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const containerRef = React.useRef<HTMLDivElement>(null)
  // 文本节点 DOM 引用表：用于测量真实渲染高度（节点用 minHeight，多行文字会撑高）
  const nodeElsRef = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const lastSerializedRef = React.useRef<string>('')
  const historyRef = React.useRef<string[]>([])
  const historyIndexRef = React.useRef(-1)
  // 当前正在编辑的输入元素（同时只会有一个），用于卸载前主动 flush
  const editTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const editInputRef = React.useRef<HTMLInputElement | null>(null)

  // 用 ref 镜像最新值，供事件回调读取，避免闭包捕获旧值
  const nodesRef = React.useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = React.useRef(edges)
  edgesRef.current = edges
  const viewRef = React.useRef(view)
  viewRef.current = view
  const selectedRef = React.useRef(selectedIds)
  selectedRef.current = selectedIds
  const editingRef = React.useRef({ node: editingNodeId, edge: editingEdgeId })
  editingRef.current = { node: editingNodeId, edge: editingEdgeId }
  const spaceRef = React.useRef(spaceDown)
  spaceRef.current = spaceDown
  // 用 ref 存 handleGroup，避免 TDZ（handleGroup 定义在 keyboard handler 之后）
  const groupRef = React.useRef<(() => void) | null>(null)

  const syncHistoryFlags = React.useCallback((): void => {
    setCanUndo(historyIndexRef.current > 0)
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1)
  }, [])

  // ===== 视图居中 =====
  const fitView = React.useCallback((ns: CanvasNode[]): void => {
    if (ns.length === 0 || !containerRef.current) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of ns) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.width)
      maxY = Math.max(maxY, n.y + n.height)
    }
    const cw = maxX - minX
    const ch = maxY - minY
    const rect = containerRef.current.getBoundingClientRect()
    const scale = Math.min(rect.width / (cw + 100), rect.height / (ch + 100), 1)
    setView({
      scale,
      offsetX: (rect.width - cw * scale) / 2 - minX * scale,
      offsetY: (rect.height - ch * scale) / 2 - minY * scale,
    })
  }, [])

  // ===== 从 atom 解析（仅外部变化时） =====
  React.useEffect(() => {
    if (!loaded) return
    if (content === lastSerializedRef.current) return
    try {
      const parsed = parseCanvas(content)
      const needLayout = parsed.nodes.length > 0 && parsed.nodes.every((n) => n.x === 0 && n.y === 0)
      if (needLayout) runForceLayout(parsed.nodes, parsed.edges)
      setNodes(parsed.nodes)
      setEdges(parsed.edges)
      const json = needLayout ? serializeCanvas(parsed.nodes, parsed.edges) : content
      lastSerializedRef.current = json
      // 外部载入视为新的历史起点
      historyRef.current = [json]
      historyIndexRef.current = 0
      syncHistoryFlags()
      requestAnimationFrame(() => fitView(parsed.nodes))
    } catch (err) {
      console.error('[Canvas] 解析失败:', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, loaded])

  // ===== 提交（写回 atom + 记历史） =====
  const commit = React.useCallback(
    (nextNodes: CanvasNode[], nextEdges: CanvasEdge[], recordHistory = true): void => {
      const json = serializeCanvas(nextNodes, nextEdges)
      if (json === lastSerializedRef.current) return
      if (recordHistory) {
        // 新操作截断 redo 分支
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
        historyRef.current.push(json)
        if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift()
        historyIndexRef.current = historyRef.current.length - 1
        syncHistoryFlags()
      }
      lastSerializedRef.current = json
      setContent(json)
    },
    [setContent, syncHistoryFlags],
  )

  const applySnapshot = React.useCallback(
    (json: string): void => {
      const parsed = parseCanvas(json)
      setNodes(parsed.nodes)
      setEdges(parsed.edges)
      setSelectedIds(new Set())
      setEditingNodeId(null)
      setEditingEdgeId(null)
      lastSerializedRef.current = json
      setContent(json)
      syncHistoryFlags()
    },
    [setContent, syncHistoryFlags],
  )

  const undo = React.useCallback((): void => {
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current -= 1
    applySnapshot(historyRef.current[historyIndexRef.current]!)
  }, [applySnapshot])

  const redo = React.useCallback((): void => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current += 1
    applySnapshot(historyRef.current[historyIndexRef.current]!)
  }, [applySnapshot])

  // ===== 新建节点 =====
  const createNodeAt = React.useCallback(
    (canvasX: number, canvasY: number): void => {
      const node: CanvasNode = {
        id: generateId(),
        type: 'text',
        x: Math.round(canvasX - NEW_NODE_WIDTH / 2),
        y: Math.round(canvasY - NEW_NODE_HEIGHT / 2),
        width: NEW_NODE_WIDTH,
        height: NEW_NODE_HEIGHT,
        text: '',
      }
      const next = [...nodesRef.current, node]
      setNodes(next)
      setSelectedIds(new Set([node.id]))
      setEditingNodeId(node.id)
      commit(next, edgesRef.current)
    },
    [commit],
  )

  // ===== 删除选中 =====
  const deleteSelected = React.useCallback((): void => {
    const sel = selectedRef.current
    if (sel.size === 0) return
    const nextNodes = nodesRef.current.filter((n) => !sel.has(n.id))
    // 连带删除挂在被删节点上的边，以及被直接选中的边
    const nextEdges = edgesRef.current.filter(
      (e) => !sel.has(e.id) && !sel.has(e.fromNode) && !sel.has(e.toNode),
    )
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedIds(new Set())
    commit(nextNodes, nextEdges)
  }, [commit])

  // ===== 复制选中 =====
  const copySelected = React.useCallback((): void => {
    const sel = selectedRef.current
    if (sel.size === 0) return
    const selNodes = nodesRef.current.filter((n) => sel.has(n.id))
    const selIds = new Set(selNodes.map((n) => n.id))
    const selEdges = edgesRef.current.filter(
      (e) => selIds.has(e.fromNode) && selIds.has(e.toNode),
    )
    if (selNodes.length === 0) return
    clipboardRef.current = {
      nodes: selNodes.map((n) => ({ ...n })),
      edges: selEdges.map((e) => ({ ...e })),
    }
  }, [])

  // ===== 粘贴 =====
  const paste = React.useCallback((): void => {
    const clip = clipboardRef.current
    if (!clip || clip.nodes.length === 0) return
    const OFFSET = 24
    // 旧 ID → 新 ID 映射
    const idMap = new Map<string, string>()
    for (const n of clip.nodes) {
      idMap.set(n.id, generateId())
    }
    // 以剪贴板内容的包围盒左上角为基准，粘贴到鼠标位置或偏移
    let minX = Infinity, minY = Infinity
    for (const n of clip.nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
    }
    const targetX = lastMouseCanvasRef.current.x || minX + OFFSET
    const targetY = lastMouseCanvasRef.current.y || minY + OFFSET
    const dx = targetX - minX + OFFSET
    const dy = targetY - minY + OFFSET
    const newNodes: CanvasNode[] = clip.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      x: Math.round(n.x + dx),
      y: Math.round(n.y + dy),
    }))
    const newEdges: CanvasEdge[] = clip.edges.map((e) => ({
      ...e,
      id: generateId(),
      fromNode: idMap.get(e.fromNode)!,
      toNode: idMap.get(e.toNode)!,
    }))
    const nextNodes = [...nodesRef.current, ...newNodes]
    const nextEdges = [...edgesRef.current, ...newEdges]
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedIds(new Set(newNodes.map((n) => n.id)))
    commit(nextNodes, nextEdges)
  }, [commit])

  // ===== 编辑 flush：在 React 卸载 textarea 之前主动提交 =====
  // React 在元素卸载时不会触发 onBlur，所以点空白导致 setEditing(null) 会丢失未提交的文字。
  // 用 capture 阶段的 document mousedown（早于 React 合成事件）在点击外部时先 flush。
  React.useEffect(() => {
    if (!editingNodeId && !editingEdgeId) return
    const onDocMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      const ta = editTextareaRef.current
      if (editingNodeId && ta && target !== ta && !ta.contains(target)) {
        handleNodeTextCommit(editingNodeId, ta.value)
      }
      const inp = editInputRef.current
      if (editingEdgeId && inp && target !== inp && !inp.contains(target)) {
        handleEdgeLabelCommit(editingEdgeId, inp.value)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNodeId, editingEdgeId])

  // ===== 键盘 =====
  React.useEffect(() => {
    const isTypingTarget = (): boolean => {
      const el = document.activeElement
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTypingTarget()) {
        if (!spaceRef.current) setSpaceDown(true)
        e.preventDefault()
        return
      }
      // 编辑中把按键交给输入框（Escape 除外）
      if (isTypingTarget()) {
        if (e.key === 'Escape') {
          setEditingNodeId(null)
          setEditingEdgeId(null)
          ;(document.activeElement as HTMLElement | null)?.blur()
        }
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(nodesRef.current.map((n) => n.id)))
        return
      }
      if (mod && e.key.toLowerCase() === 'c') {
        copySelected()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        paste()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        // 复制选中（in-place duplicate）
        e.preventDefault()
        copySelected()
        paste()
        return
      }
      if (mod && e.key.toLowerCase() === 'g') {
        // 成组
        e.preventDefault()
        groupRef.current?.()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRef.current.size > 0) {
          e.preventDefault()
          deleteSelected()
        }
        return
      }
      if (e.key === 'Escape') {
        setSelectedIds(new Set())
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpaceDown(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [undo, redo, deleteSelected, copySelected, paste])

  // ===== 画布平移 =====
  const startPan = React.useCallback((e: React.MouseEvent | MouseEvent): void => {
    const startX = e.clientX
    const startY = e.clientY
    const origX = viewRef.current.offsetX
    const origY = viewRef.current.offsetY
    const onMove = (ev: MouseEvent): void => {
      setView((v) => ({ ...v, offsetX: origX + (ev.clientX - startX), offsetY: origY + (ev.clientY - startY) }))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // ===== 空白处按下：平移 或 框选 =====
  const handleBackgroundMouseDown = React.useCallback(
    (e: React.MouseEvent): void => {
      if ((e.target as HTMLElement).closest('.canvas-node')) return
      setEditingNodeId(null)
      setEditingEdgeId(null)

      // 中键 或 空格 → 平移
      if (e.button === 1 || spaceRef.current) {
        e.preventDefault()
        startPan(e)
        return
      }
      if (e.button !== 0) return
      if (!containerRef.current) return

      // 左键 → 框选
      const rect = containerRef.current.getBoundingClientRect()
      const start = screenToCanvas(e.clientX, e.clientY, rect, viewRef.current)
      const additive = e.shiftKey
      const baseSelection = additive ? new Set(selectedRef.current) : new Set<string>()
      if (!additive) setSelectedIds(new Set())
      let moved = false

      const onMove = (ev: MouseEvent): void => {
        const cur = screenToCanvas(ev.clientX, ev.clientY, rect, viewRef.current)
        const box = normalizeRect(start.x, start.y, cur.x, cur.y)
        if (box.width > 3 || box.height > 3) moved = true
        setMarquee(box)
        const next = new Set(baseSelection)
        for (const n of nodesRef.current) {
          if (rectsIntersect(box, n)) next.add(n.id)
        }
        setSelectedIds(next)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setMarquee(null)
        if (!moved && !additive) setSelectedIds(new Set())
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [startPan],
  )

  // ===== 空白双击 → 新建节点 =====
  const handleBackgroundDoubleClick = React.useCallback(
    (e: React.MouseEvent): void => {
      if ((e.target as HTMLElement).closest('.canvas-node')) return
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pt = screenToCanvas(e.clientX, e.clientY, rect, viewRef.current)
      createNodeAt(pt.x, pt.y)
    },
    [createNodeAt],
  )

  // ===== 节点拖拽（支持多选整体移动） =====
  const handleNodeMouseDown = React.useCallback(
    (e: React.MouseEvent, nodeId: string): void => {
      if (editingRef.current.node === nodeId) return
      if (e.button !== 0) return
      e.stopPropagation()

      // 选中逻辑：Shift 追加/取消；点未选中的节点则独占选中
      let working = new Set(selectedRef.current)
      if (e.shiftKey) {
        if (working.has(nodeId)) working.delete(nodeId)
        else working.add(nodeId)
        setSelectedIds(new Set(working))
      } else if (!working.has(nodeId)) {
        working = new Set([nodeId])
        setSelectedIds(working)
      }

      const movingIds = working.has(nodeId) ? Array.from(working) : [nodeId]
      const origins = new Map<string, { x: number; y: number }>()
      for (const id of movingIds) {
        const n = nodesRef.current.find((x) => x.id === id)
        if (n) origins.set(id, { x: n.x, y: n.y })
      }
      // 如果拖的是 group 节点，找出几何上在 group 范围内的成员，一并移动
      const groupNode = nodesRef.current.find((n) => n.id === nodeId && n.type === 'group')
      if (groupNode) {
        const groupRect = { x: groupNode.x, y: groupNode.y, width: groupNode.width, height: groupNode.height }
        for (const n of nodesRef.current) {
          if (n.type === 'group' || movingIds.includes(n.id)) continue
          // 节点中心在 group 框内就算成员
          const cx = n.x + n.width / 2
          const cy = n.y + n.height / 2
          if (cx >= groupRect.x && cx <= groupRect.x + groupRect.width &&
              cy >= groupRect.y && cy <= groupRect.y + groupRect.height) {
            movingIds.push(n.id)
            origins.set(n.id, { x: n.x, y: n.y })
          }
        }
      }
      const movingIdsSet = new Set(movingIds)
      const startX = e.clientX
      const startY = e.clientY
      let moved = false

      const onMove = (ev: MouseEvent): void => {
        const scale = viewRef.current.scale
        const dx = (ev.clientX - startX) / scale
        const dy = (ev.clientY - startY) / scale
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true

        // 先计算拖拽后的位置
        const dragRects = movingIds.map((id) => {
          const o = origins.get(id)!
          const n = nodesRef.current.find((x) => x.id === id)
          return { id, x: o.x + dx, y: o.y + dy, width: n?.width ?? 200, height: n?.height ?? 60 }
        })
        const others = nodesRef.current.filter((n) => !movingIdsSet.has(n.id))
        const { snapDx, snapDy, guides } = computeSnapGuides(dragRects, others)
        const finalDx = dx + snapDx
        const finalDy = dy + snapDy

        setNodes((prev) =>
          prev.map((n) => {
            const o = origins.get(n.id)
            return o ? { ...n, x: o.x + finalDx, y: o.y + finalDy } : n
          }),
        )
        setActiveGuides(guides)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setActiveGuides([])
        if (moved) commit(nodesRef.current, edgesRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [commit],
  )

  // ===== 节点 resize =====
  const handleResizeStart = React.useCallback(
    (e: React.MouseEvent, nodeId: string): void => {
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      const node = nodesRef.current.find((n) => n.id === nodeId)
      if (!node) return
      const origW = node.width
      const origH = node.height

      const onMove = (ev: MouseEvent): void => {
        const scale = viewRef.current.scale
        const nw = Math.max(80, origW + (ev.clientX - startX) / scale)
        const nh = Math.max(40, origH + (ev.clientY - startY) / scale)
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, width: nw, height: nh } : n)))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        commit(nodesRef.current, edgesRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [commit],
  )

  // ===== 从锚点拖出连线 =====
  const handleAnchorMouseDown = React.useCallback(
    (e: React.MouseEvent, nodeId: string, side: NodeSide): void => {
      e.stopPropagation()
      e.preventDefault()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const from = nodesRef.current.find((n) => n.id === nodeId)
      if (!from) return
      const anchor = getSidePoint(from, side)
      setPendingEdge({ fromNode: nodeId, fromSide: side, toX: anchor.x, toY: anchor.y })

      const onMove = (ev: MouseEvent): void => {
        const pt = screenToCanvas(ev.clientX, ev.clientY, rect, viewRef.current)
        setPendingEdge((p) => (p ? { ...p, toX: pt.x, toY: pt.y } : p))
      }
      const onUp = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const pt = screenToCanvas(ev.clientX, ev.clientY, rect, viewRef.current)
        const target = hitTestNode(nodesRef.current, pt.x, pt.y)
        setPendingEdge(null)

        if (target && target.id !== nodeId) {
          // 连到已有节点：允许一对节点间多条边（不去重）；toSide 取落点最近的边
          const edge: CanvasEdge = {
            id: generateId(),
            fromNode: nodeId,
            toNode: target.id,
            fromSide: side,
            toSide: nearestSide(target, pt.x, pt.y),
          }
          const nextEdges = [...edgesRef.current, edge]
          setEdges(nextEdges)
          commit(nodesRef.current, nextEdges)
        } else if (!target) {
          // 拖到空白 → 新建节点并连上（OB 同款手感）
          const node: CanvasNode = {
            id: generateId(),
            type: 'text',
            x: Math.round(pt.x - NEW_NODE_WIDTH / 2),
            y: Math.round(pt.y - NEW_NODE_HEIGHT / 2),
            width: NEW_NODE_WIDTH,
            height: NEW_NODE_HEIGHT,
            text: '',
          }
          const edge: CanvasEdge = {
            id: generateId(),
            fromNode: nodeId,
            toNode: node.id,
            fromSide: side,
            toSide: inferSide(getSidePoint(from, side).x - pt.x, getSidePoint(from, side).y - pt.y),
          }
          const nextNodes = [...nodesRef.current, node]
          const nextEdges = [...edgesRef.current, edge]
          setNodes(nextNodes)
          setEdges(nextEdges)
          setSelectedIds(new Set([node.id]))
          setEditingNodeId(node.id)
          commit(nextNodes, nextEdges)
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [commit],
  )

  // ===== 滚轮：平移；⌘/Ctrl+滚轮（含触控板捏合）：缩放 =====
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        setView((v) => {
          const ns = Math.max(0.1, Math.min(4, v.scale * Math.exp(-e.deltaY * 0.01)))
          return {
            scale: ns,
            offsetX: mx - (mx - v.offsetX) * (ns / v.scale),
            offsetY: my - (my - v.offsetY) * (ns / v.scale),
          }
        })
      } else {
        setView((v) => ({ ...v, offsetX: v.offsetX - e.deltaX, offsetY: v.offsetY - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ===== 编辑提交 =====
  const handleNodeTextCommit = React.useCallback(
    (nodeId: string, text: string): void => {
      setEditingNodeId(null)
      const cur = nodesRef.current.find((n) => n.id === nodeId)
      if (!cur) return
      // group 节点：写 label，空 label 也合法（不自动删除）
      if (cur.type === 'group') {
        if (text === (cur.label || '')) return
        const next = nodesRef.current.map((n) => (n.id === nodeId ? { ...n, label: text || undefined } : n))
        setNodes(next)
        commit(next, edgesRef.current)
        return
      }
      // 普通节点：新建后未输入内容 → 直接丢弃，避免留下空节点
      if (!text.trim() && !cur.text.trim()) {
        const nextNodes = nodesRef.current.filter((n) => n.id !== nodeId)
        const nextEdges = edgesRef.current.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId)
        setNodes(nextNodes)
        setEdges(nextEdges)
        commit(nextNodes, nextEdges)
        return
      }
      if (text === cur.text) return
      const next = nodesRef.current.map((n) => (n.id === nodeId ? { ...n, text } : n))
      setNodes(next)
      commit(next, edgesRef.current)
    },
    [commit],
  )

  const handleEdgeLabelCommit = React.useCallback(
    (edgeId: string, label: string): void => {
      setEditingEdgeId(null)
      const next = edgesRef.current.map((e) => (e.id === edgeId ? { ...e, label: label || undefined } : e))
      setEdges(next)
      commit(nodesRef.current, next)
    },
    [commit],
  )

  // ===== 工具栏动作 =====
  const handleAutoLayout = React.useCallback((): void => {
    const cloned = nodesRef.current.map((n) => ({ ...n, x: 0, y: 0 }))
    runForceLayout(cloned, edgesRef.current)
    setNodes(cloned)
    commit(cloned, edgesRef.current)
    requestAnimationFrame(() => fitView(cloned))
  }, [commit, fitView])

  // ===== 成组 =====
  const handleGroup = React.useCallback((): void => {
    const sel = selectedRef.current
    const members = nodesRef.current.filter((n) => sel.has(n.id) && n.type !== 'group')
    if (members.length === 0) return
    const group = makeGroupForSelection(members, '')
    // group 放到数组最前（渲染在最底层）
    const next = [group, ...nodesRef.current]
    setNodes(next)
    setSelectedIds(new Set([group.id]))
    setEditingNodeId(group.id)
    commit(next, edgesRef.current)
  }, [commit])
  groupRef.current = handleGroup
  const selectedTextCount = React.useMemo(
    () => nodes.filter((n) => selectedIds.has(n.id) && n.type !== 'group').length,
    [nodes, selectedIds],
  )

  const handleExport = React.useCallback(
    async (name: string, context: string): Promise<void> => {
      const cluster = extractCluster(nodesRef.current, edgesRef.current, selectedRef.current)
      if (cluster.nodes.length === 0) {
        toast.error('没有选中可导出的节点')
        return
      }
      const canvasJson = serializeCanvas(cluster.nodes, cluster.edges)
      const markdown = buildClusterMarkdown(name, context, cluster.nodes, cluster.edges)
      try {
        const res = await window.electronAPI.exportCanvasCluster?.({ name, canvasJson, markdown })
        if (res?.ok) {
          toast.success('已导出到 canvas-exports', { description: res.mdPath })
          setExportOpen(false)
        } else {
          toast.error('导出失败', { description: res?.error })
        }
      } catch (err) {
        console.error('[Canvas] 导出失败:', err)
        toast.error('导出失败')
      }
    },
    [],
  )

  // ===== SVG 画布范围（覆盖所有节点，保证连线可被点击） =====
  const svgBox = React.useMemo(() => {
    const PAD = 2000
    if (nodes.length === 0) return { x: -PAD, y: -PAD, width: PAD * 2, height: PAD * 2 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.width)
      maxY = Math.max(maxY, n.y + n.height)
    }
    return { x: minX - PAD, y: minY - PAD, width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 }
  }, [nodes])

  // 多条平行/双向边的横向错开量
  const edgeBows = React.useMemo(() => computeEdgeBows(edges, nodes), [edges, nodes])

  // ===== 同步节点真实高度 =====
  // 文本节点用 minHeight 渲染，多行文字会把节点撑高，但 n.height 仍是初始值。
  // 若不同步，连线锚点（getSidePoint 用 height）会偏移、命中测试（hitTestNode 用 height）
  // 会在节点下半部分失效，导致“连线终点偏移”和“从某方向连线变成新建节点”。
  // 这里在每次渲染后测量真实 offsetHeight 并回写，宽度固定 → 换行确定 → 高度收敛，不会死循环。
  React.useLayoutEffect(() => {
    if (!loaded) return
    let changed = false
    const next = nodesRef.current.map((n) => {
      if (n.type === 'group') return n // group 高度显式管理，不测量
      // 正在编辑的节点：textarea 高度随输入瞬变，编辑结束后再测量，避免编辑态下反复回写
      if (n.id === editingRef.current.node) return n
      const el = nodeElsRef.current.get(n.id)
      if (!el) return n
      const h = el.offsetHeight // 不受画布 scale transform 影响，返回布局高度
      if (h > 0 && Math.abs(h - n.height) > 0.5) {
        changed = true
        return { ...n, height: h }
      }
      return n
    })
    if (changed) {
      setNodes(next)
      // 静默持久化（不记历史）：让磁盘与命中测试用到的高度一致，重载后几何正确
      commit(next, edgesRef.current, false)
    }
  }, [nodes, loaded, commit])

  const edgeColorFor = (color?: string): string =>
    color && COLOR_PRESETS[color] ? COLOR_PRESETS[color].border : 'hsl(var(--muted-foreground) / 0.55)'

  const pendingFrom = pendingEdge ? nodes.find((n) => n.id === pendingEdge.fromNode) : undefined

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-content-area titlebar-no-drag">
      {/* 工具栏（titlebar-no-drag：右侧工作区 Tab 场景下工具栏可能位于窗口顶部拖拽带内，不标 no-drag 会被 OS 拖拽区吞掉点击/hover） */}
      <div className="flex h-[34px] flex-shrink-0 items-center gap-1 border-b border-border/30 px-3">
        <span className="text-xs text-muted-foreground">会话画布</span>
        <div className="ml-auto flex items-center gap-0.5">
          {selectedTextCount > 0 && (
            <>
              <ToolbarButton label="成组 (⌘G)" onClick={handleGroup} icon={<Group className="size-3.5" />} />
              <ToolbarButton
                label={`导出选中 ${selectedTextCount} 个节点为独立文件`}
                onClick={() => setExportOpen(true)}
                icon={<Upload className="size-3.5" />}
              />
              <div className="mx-1 h-4 w-px bg-border/50" />
            </>
          )}
          <ToolbarButton label="撤销 (⌘Z)" onClick={undo} disabled={!canUndo} icon={<Undo2 className="size-3.5" />} />
          <ToolbarButton label="重做 (⌘⇧Z)" onClick={redo} disabled={!canRedo} icon={<Redo2 className="size-3.5" />} />
          <div className="mx-1 h-4 w-px bg-border/50" />
          <ToolbarButton label="自动整理" onClick={handleAutoLayout} icon={<LayoutGrid className="size-3.5" />} />
          <ToolbarButton label="回到中心" onClick={() => fitView(nodesRef.current)} icon={<Crosshair className="size-3.5" />} />
          {onClose && (
            <ToolbarButton label="关闭画布" onClick={onClose} icon={<X className="size-3.5" />} />
          )}
        </div>
      </div>

      {/* 画布容器 */}
      <div
        ref={containerRef}
        className={`canvas-grid relative min-h-0 flex-1 overflow-hidden ${
          spaceDown ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
        onMouseDown={handleBackgroundMouseDown}
        onMouseMove={(e) => {
          if (!containerRef.current) return
          const rect = containerRef.current.getBoundingClientRect()
          const pt = screenToCanvas(e.clientX, e.clientY, rect, viewRef.current)
          lastMouseCanvasRef.current = pt
        }}
        onDoubleClick={handleBackgroundDoubleClick}
      >
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/40">加载中…</div>
        ) : (
          <>
            {nodes.length === 0 && (
              <div className="pointer-events-none flex h-full items-center justify-center text-sm text-muted-foreground/50">
                双击空白处创建第一个节点
              </div>
            )}
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})` }}
            >
              {/* 连线层 */}
              <svg
                className="absolute"
                style={{
                  left: svgBox.x,
                  top: svgBox.y,
                  width: svgBox.width,
                  height: svgBox.height,
                  pointerEvents: 'none',
                  overflow: 'visible',
                }}
              >
                <defs>
                  <marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 7 3, 0 6" fill="hsl(var(--muted-foreground) / 0.55)" />
                  </marker>
                </defs>
                <g transform={`translate(${-svgBox.x}, ${-svgBox.y})`}>
                  {edges.map((e) => {
                    const from = nodes.find((n) => n.id === e.fromNode)
                    const to = nodes.find((n) => n.id === e.toNode)
                    if (!from || !to) return null
                    const { d, midX, midY } = computeEdgePath(from, to, e.fromSide, e.toSide, edgeBows.get(e.id) || 0)
                    const selected = selectedIds.has(e.id)
                    return (
                      <g key={e.id}>
                        {/* 加宽的透明命中区，方便点中细线 */}
                        <path
                          d={d}
                          stroke="transparent"
                          strokeWidth={12}
                          fill="none"
                          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onMouseDown={(ev) => {
                            ev.stopPropagation()
                            setSelectedIds(new Set([e.id]))
                          }}
                          onDoubleClick={(ev) => {
                            ev.stopPropagation()
                            setEditingEdgeId(e.id)
                          }}
                        />
                        <path
                          d={d}
                          stroke={selected ? 'hsl(var(--primary))' : edgeColorFor(e.color)}
                          strokeWidth={selected ? 2.5 : 1.5}
                          fill="none"
                          markerEnd="url(#canvas-arrow)"
                          style={{ pointerEvents: 'none' }}
                        />
                        {e.label && editingEdgeId !== e.id && (
                          <text
                            x={midX}
                            y={midY + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="canvas-edge-label"
                            style={{ pointerEvents: 'auto', cursor: 'text' }}
                            onDoubleClick={(ev) => {
                              ev.stopPropagation()
                              setEditingEdgeId(e.id)
                            }}
                          >
                            {e.label}
                          </text>
                        )}
                      </g>
                    )
                  })}

                  {/* 正在拖拽的连线 */}
                  {pendingEdge && pendingFrom && (
                    (() => {
                      const a = getSidePoint(pendingFrom, pendingEdge.fromSide)
                      return (
                        <path
                          d={`M ${a.x} ${a.y} L ${pendingEdge.toX} ${pendingEdge.toY}`}
                          stroke="hsl(var(--primary))"
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          fill="none"
                          style={{ pointerEvents: 'none' }}
                        />
                      )
                    })()
                  )}

                  {/* 框选矩形 */}
                  {marquee && (
                    <rect
                      x={marquee.x}
                      y={marquee.y}
                      width={marquee.width}
                      height={marquee.height}
                      fill="hsl(var(--primary) / 0.08)"
                      stroke="hsl(var(--primary) / 0.5)"
                      strokeWidth={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  {/* 智能对齐辅助线 */}
                  {activeGuides.map((g, i) =>
                    g.orient === 'v' ? (
                      <line
                        key={`guide-${i}`}
                        x1={g.pos}
                        y1={g.start}
                        x2={g.pos}
                        y2={g.end}
                        stroke="hsl(var(--primary))"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        style={{ pointerEvents: 'none' }}
                      />
                    ) : (
                      <line
                        key={`guide-${i}`}
                        x1={g.start}
                        y1={g.pos}
                        x2={g.end}
                        y2={g.pos}
                        stroke="hsl(var(--primary))"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        style={{ pointerEvents: 'none' }}
                      />
                    ),
                  )}
                </g>
              </svg>

              {/* 连线标签编辑 */}
              {editingEdgeId &&
                (() => {
                  const e = edges.find((x) => x.id === editingEdgeId)
                  if (!e) return null
                  const from = nodes.find((n) => n.id === e.fromNode)
                  const to = nodes.find((n) => n.id === e.toNode)
                  if (!from || !to) return null
                  const { midX, midY } = computeEdgePath(from, to, e.fromSide, e.toSide, edgeBows.get(e.id) || 0)
                  return (
                    <input
                      ref={editInputRef}
                      autoFocus
                      defaultValue={e.label || ''}
                      className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded border border-primary bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none"
                      style={{ left: midX, top: midY }}
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onBlur={(ev) => handleEdgeLabelCommit(e.id, ev.target.value)}
                      onKeyDown={(ev) => {
                        // 输入法 composing（Enter 选词）阶段不提交
                        if (ev.nativeEvent.isComposing || ev.keyCode === 229) return
                        if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
                      }}
                    />
                  )
                })()}

              {/* 节点层 */}
              {nodes.map((n) => {
                const preset = n.color ? COLOR_PRESETS[n.color] : undefined
                const isEditing = editingNodeId === n.id
                const isSelected = selectedIds.has(n.id)
                const showAnchors = (hoveredNodeId === n.id || isSelected) && !isEditing

                // group 节点：半透明包围框 + 顶部标题，渲染在最底层
                if (n.type === 'group') {
                  return (
                    <div
                      key={n.id}
                      className="canvas-node absolute rounded-lg border-2 border-dashed"
                      style={{
                        left: n.x,
                        top: n.y,
                        width: n.width,
                        height: n.height,
                        borderColor: isSelected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.4)',
                        background: 'hsl(var(--muted-foreground) / 0.05)',
                        cursor: isEditing ? 'text' : 'move',
                      }}
                      onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setEditingNodeId(n.id)
                      }}
                    >
                      {isEditing ? (
                        <textarea
                          ref={editTextareaRef}
                          autoFocus
                          rows={1}
                          defaultValue={n.label || ''}
                          placeholder="簇名称"
                          className="absolute left-2 top-1 w-[calc(100%-1rem)] resize-none bg-transparent text-[12px] font-medium text-muted-foreground outline-none"
                          onFocus={(ev) => ev.currentTarget.select()}
                          onMouseDown={(ev) => ev.stopPropagation()}
                          onBlur={(ev) => handleNodeTextCommit(n.id, ev.target.value)}
                          onKeyDown={(ev) => {
                            // 输入法 composing（Enter 选词）阶段不提交
                            if (ev.nativeEvent.isComposing || ev.keyCode === 229) return
                            if (ev.key === 'Enter') {
                              ev.preventDefault()
                              ;(ev.target as HTMLTextAreaElement).blur()
                            }
                          }}
                        />
                      ) : (
                        <div className="absolute left-2 top-1 truncate text-[12px] font-medium text-muted-foreground">
                          {n.label || <span className="text-muted-foreground/40">双击命名簇</span>}
                        </div>
                      )}
                      {/* resize 手柄 */}
                      <div
                        className="absolute bottom-0 right-0 size-3.5 cursor-nwse-resize opacity-40 hover:opacity-100"
                        style={{
                          background: 'linear-gradient(135deg, transparent 50%, hsl(var(--muted-foreground) / 0.5) 50%)',
                          borderBottomRightRadius: 8,
                        }}
                        onMouseDown={(e) => handleResizeStart(e, n.id)}
                      />
                    </div>
                  )
                }

                return (
                  <div
                    key={n.id}
                    ref={(el) => {
                      if (el) nodeElsRef.current.set(n.id, el)
                      else nodeElsRef.current.delete(n.id)
                    }}
                    className="canvas-node group absolute flex select-none items-center rounded-md border shadow-sm"
                    style={{
                      left: n.x,
                      top: n.y,
                      width: n.width,
                      minHeight: n.height,
                      background: preset ? preset.bg : 'hsl(var(--card))',
                      borderColor: isSelected ? 'hsl(var(--primary))' : preset ? preset.border : 'hsl(var(--border))',
                      borderWidth: isSelected ? 2 : 1,
                      color: preset ? preset.text : 'hsl(var(--card-foreground))',
                      cursor: isEditing ? 'text' : 'move',
                      boxShadow: isSelected ? '0 0 0 3px hsl(var(--primary) / 0.15)' : undefined,
                    }}
                    onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
                    onMouseEnter={() => setHoveredNodeId(n.id)}
                    onMouseLeave={() => setHoveredNodeId((cur) => (cur === n.id ? null : cur))}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setEditingNodeId(n.id)
                    }}
                  >
                    {isEditing ? (
                      <textarea
                        ref={editTextareaRef}
                        autoFocus
                        defaultValue={n.text}
                        className="h-full min-h-[inherit] w-full resize-none bg-transparent p-2.5 text-[13px] leading-snug outline-none"
                        style={{ color: 'inherit' }}
                        onFocus={(ev) => ev.currentTarget.select()}
                        onMouseDown={(ev) => ev.stopPropagation()}
                        onBlur={(ev) => handleNodeTextCommit(n.id, ev.target.value)}
                        onKeyDown={(ev) => {
                          // 中文输入法 composing 阶段（含用 Enter 选词）不当作提交
                          if (ev.nativeEvent.isComposing || ev.keyCode === 229) return
                          if (ev.key === 'Enter' && !ev.shiftKey) {
                            ev.preventDefault()
                            ;(ev.target as HTMLTextAreaElement).blur()
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full whitespace-pre-wrap break-words p-2.5 text-[13px] leading-snug">
                        {n.text || <span className="text-muted-foreground/40">空节点</span>}
                      </div>
                    )}

                    {/* 四边连线锚点 */}
                    {showAnchors &&
                      ALL_SIDES.map((side) => {
                        const pos: React.CSSProperties =
                          side === 'top'
                            ? { left: '50%', top: -5, marginLeft: -5 }
                            : side === 'bottom'
                              ? { left: '50%', bottom: -5, marginLeft: -5 }
                              : side === 'left'
                                ? { top: '50%', left: -5, marginTop: -5 }
                                : { top: '50%', right: -5, marginTop: -5 }
                        return (
                          <div
                            key={side}
                            className="absolute size-2.5 rounded-full border-2 transition-transform hover:scale-150"
                            style={{
                              ...pos,
                              background: 'hsl(var(--background))',
                              borderColor: 'hsl(var(--primary))',
                              cursor: 'crosshair',
                              zIndex: 10,
                            }}
                            onMouseDown={(e) => handleAnchorMouseDown(e, n.id, side)}
                          />
                        )
                      })}

                    {/* resize 手柄 */}
                    <div
                      className="absolute bottom-0 right-0 size-3.5 cursor-nwse-resize opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                      style={{
                        background: 'linear-gradient(135deg, transparent 50%, currentColor 50%)',
                        borderBottomRightRadius: 6,
                      }}
                      onMouseDown={(e) => handleResizeStart(e, n.id)}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* 导出对话框 */}
        {exportOpen && (
          <ExportDialog
            count={selectedTextCount}
            defaultName={todayStamp()}
            onCancel={() => setExportOpen(false)}
            onExport={handleExport}
          />
        )}

        {/* 状态条 */}
        {loaded && (
          <div className="pointer-events-none absolute bottom-2.5 right-3 flex items-center gap-2 rounded border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
            {selectedIds.size > 0 && <span>已选 {selectedIds.size} · ⌘G 成组 · ⌘C/V 复制</span>}
            <span>
              {nodes.length} 节点 · {edges.length} 连线
            </span>
            <span>{Math.round(view.scale * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

interface ToolbarButtonProps {
  label: string
  onClick: () => void
  icon: React.ReactNode
  disabled?: boolean
}

interface ExportDialogProps {
  count: number
  defaultName: string
  onCancel: () => void
  onExport: (name: string, context: string) => void | Promise<void>
}

/** 导出对话框：名称 + context（支持语音听写插入） */
function ExportDialog({ count, defaultName, onCancel, onExport }: ExportDialogProps): React.ReactElement {
  const [name, setName] = React.useState(defaultName)
  const [context, setContext] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const contextRef = React.useRef<HTMLTextAreaElement>(null)

  // 接住全局语音听写：派发 proma:insert-voice-dictation-text 时插入到 context 光标处
  React.useEffect(() => {
    const onInsert = (e: Event): void => {
      const ce = e as CustomEvent<{ text: string }>
      const ta = contextRef.current
      if (!ta || !ce.detail?.text) return
      e.preventDefault()
      const start = ta.selectionStart ?? ta.value.length
      const end = ta.selectionEnd ?? ta.value.length
      const next = ta.value.slice(0, start) + ce.detail.text + ta.value.slice(end)
      setContext(next)
      requestAnimationFrame(() => {
        ta.focus()
        const pos = start + ce.detail.text.length
        ta.setSelectionRange(pos, pos)
      })
    }
    window.addEventListener('proma:insert-voice-dictation-text', onInsert)
    return () => window.removeEventListener('proma:insert-voice-dictation-text', onInsert)
  }, [])

  const doExport = async (): Promise<void> => {
    setBusy(true)
    await onExport(name.trim() || defaultName, context)
    setBusy(false)
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30" onMouseDown={onCancel}>
      <div
        className="w-[440px] max-w-[90%] rounded-lg border border-border bg-background p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">导出选中簇（{count} 个节点）</h3>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground" aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>

        <label className="mb-1 block text-[12px] text-muted-foreground">文件名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded border border-border bg-card px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-primary"
          placeholder="YYMMDD"
        />

        <div className="mb-1 flex items-center justify-between">
          <label className="text-[12px] text-muted-foreground">这个簇在讲什么（可口述）</label>
          <button
            type="button"
            onClick={() => window.electronAPI.toggleVoiceDictation?.().catch(console.error)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Mic className="size-3" />
            语音
          </button>
        </div>
        <textarea
          ref={contextRef}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={5}
          className="mb-1 w-full resize-none rounded border border-border bg-card px-2 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-primary"
          placeholder="对着这个思维导图口述它在讲什么，会写进伴侣 .md，供 agent 搜索。"
        />
        <p className="mb-3 text-[11px] text-muted-foreground/60">
          导出到 ~/.proma/canvas-exports/（.canvas + .md）。语音先存原始转写，tone 改写待后续。
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted/50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={doExport}
            disabled={busy}
            className="rounded bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? '导出中…' : '导出'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ToolbarButton({ label, onClick, icon, disabled }: ToolbarButtonProps): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={disabled ? undefined : onClick}
          className={`flex size-7 items-center justify-center rounded transition-colors ${disabled ? 'opacity-30 cursor-default' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground cursor-pointer'}`}
          title={label}
          aria-label={label}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}
