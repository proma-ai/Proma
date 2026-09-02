/**
 * Canvas 纯逻辑工具
 *
 * 采用 JSON Canvas 开源格式（github.com/obsidianmd/jsoncanvas），与 Obsidian Canvas 互通。
 * 这里只放无副作用的解析/序列化/几何/布局函数，交互逻辑在 CanvasView.tsx。
 */

export interface CanvasNode {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  text: string
  color?: string
  /** group 节点的标题 */
  label?: string
}

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  label?: string
  color?: string
  fromSide?: string
  toSide?: string
}

export interface ViewState {
  scale: number
  offsetX: number
  offsetY: number
}

export type NodeSide = 'top' | 'right' | 'bottom' | 'left'

/** JSON Canvas color 预设映射（Obsidian 兼容；spec 故意不定义具体色值） */
export const COLOR_PRESETS: Record<string, { bg: string; border: string; text: string }> = {
  '1': { bg: '#fa5252', border: '#e03131', text: '#fff' },
  '2': { bg: '#fd7e14', border: '#e8590c', text: '#fff' },
  '3': { bg: '#fab005', border: '#f08c00', text: '#1a1a1a' },
  '4': { bg: '#40c057', border: '#2f9e44', text: '#fff' },
  '5': { bg: '#15aabf', border: '#1098ad', text: '#fff' },
  '6': { bg: '#7950f2', border: '#6741d9', text: '#fff' },
}

export const DEFAULT_WIDTH = 250
export const DEFAULT_HEIGHT = 60
/** 新建节点的默认尺寸（比导入节点小，符合手写短概念的习惯） */
export const NEW_NODE_WIDTH = 200
export const NEW_NODE_HEIGHT = 60

// ===== 解析 / 序列化 =====

export function parseCanvas(json: string): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  if (!json.trim()) return { nodes: [], edges: [] }
  const data = JSON.parse(json)
  const nodes: CanvasNode[] = (data.nodes || []).map((n: Record<string, unknown>) => ({
    id: String(n.id),
    type: (n.type as string) || 'text',
    x: typeof n.x === 'number' ? n.x : 0,
    y: typeof n.y === 'number' ? n.y : 0,
    width: typeof n.width === 'number' ? n.width : DEFAULT_WIDTH,
    height: typeof n.height === 'number' ? n.height : DEFAULT_HEIGHT,
    text: (n.text as string) || (n.label as string) || '',
    color: (n.color as string) || undefined,
    label: (n.label as string) || undefined,
  }))
  const edges: CanvasEdge[] = (data.edges || []).map((e: Record<string, unknown>) => ({
    id: String(e.id),
    fromNode: String(e.fromNode),
    toNode: String(e.toNode),
    label: (e.label as string) || undefined,
    color: (e.color as string) || undefined,
    fromSide: (e.fromSide as string) || undefined,
    toSide: (e.toSide as string) || undefined,
  }))
  return { nodes, edges }
}

export function serializeCanvas(nodes: CanvasNode[], edges: CanvasEdge[]): string {
  const data = {
    nodes: nodes.map((n) => {
      const o: Record<string, unknown> = {
        id: n.id,
        type: n.type || 'text',
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: Math.round(n.width),
        height: Math.round(n.height),
      }
      // group 节点用 label，其它用 text
      if (n.type === 'group') {
        if (n.label) o.label = n.label
      } else {
        o.text = n.text
      }
      if (n.color) o.color = n.color
      return o
    }),
    edges: edges.map((e) => {
      const o: Record<string, unknown> = { id: e.id, fromNode: e.fromNode, toNode: e.toNode }
      if (e.label) o.label = e.label
      if (e.color) o.color = e.color
      if (e.fromSide) o.fromSide = e.fromSide
      if (e.toSide) o.toSide = e.toSide
      return o
    }),
  }
  return JSON.stringify(data, null, 2)
}

// ===== ID 生成 =====

/** JSON Canvas 的 id 是任意字符串；用 16 位十六进制，与 Obsidian 风格一致 */
export function generateId(): string {
  let s = ''
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// ===== 坐标换算 =====

/** 屏幕坐标 → 画布坐标 */
export function screenToCanvas(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  view: ViewState,
): { x: number; y: number } {
  return {
    x: (clientX - containerRect.left - view.offsetX) / view.scale,
    y: (clientY - containerRect.top - view.offsetY) / view.scale,
  }
}

// ===== 命中测试 =====

/** 找出画布坐标点落在哪个节点内（后绘制的在上层，故从后往前找） */
export function hitTestNode(nodes: CanvasNode[], x: number, y: number): CanvasNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!
    if (n.type === 'group') continue // group 不参与连线命中
    if (x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) return n
  }
  return null
}

/** 矩形相交测试（marquee 框选用） */
export function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y)
}

/** 把两点规整成左上角 + 宽高的矩形 */
export function normalizeRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

// ===== 连线几何 =====

/** 从节点中心朝目标点射出，求与节点矩形边框的交点 */
export function getRectEdgePoint(
  node: { x: number; y: number; width: number; height: number },
  targetCx: number,
  targetCy: number,
): { x: number; y: number } {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const dx = targetCx - cx
  const dy = targetCy - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const hw = node.width / 2
  const hh = node.height / 2
  const t = Math.min(
    Math.abs(dx) > 0.01 ? hw / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0.01 ? hh / Math.abs(dy) : Infinity,
  )
  return { x: cx + dx * t, y: cy + dy * t }
}

/** 判断点离节点哪条边最近（拖拽落点开始时选入边） */
export function nearestSide(
  node: { x: number; y: number; width: number; height: number },
  px: number,
  py: number,
): NodeSide {
  const dTop = Math.abs(py - node.y)
  const dBottom = Math.abs(py - (node.y + node.height))
  const dLeft = Math.abs(px - node.x)
  const dRight = Math.abs(px - (node.x + node.width))
  const min = Math.min(dTop, dBottom, dLeft, dRight)
  if (min === dTop) return 'top'
  if (min === dBottom) return 'bottom'
  if (min === dLeft) return 'left'
  return 'right'
}

/** 取节点某一边的中点（连线锚点位置） */
export function getSidePoint(
  node: { x: number; y: number; width: number; height: number },
  side: NodeSide,
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
  }
}

/** 根据相对方位推断连线该从哪条边出发 */
export function inferSide(dx: number, dy: number): NodeSide {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

/** 某条边朝外的单位法向量（贝塞尔控制点沿此方向伸出，形成 OB 式平滑进出） */
export function sideNormal(side: NodeSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
  }
}

type Rect = { x: number; y: number; width: number; height: number }

/** 无显式 side 时，按两节点中心相对位置自动选出入边 */
export function autoSides(from: Rect, to: Rect): { fromSide: NodeSide; toSide: NodeSide } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' }
  }
  return dy > 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' }
}

/**
 * 计算 OB 风格的平滑连线：三次贝塞尔，控制点沿两端边法向伸出。
 * 返回 SVG path、标签锚点（曲线中点）以及箭头末端切线角度。
 */
export function computeEdgePath(
  from: Rect,
  to: Rect,
  explicitFromSide?: string,
  explicitToSide?: string,
  bowOffset = 0,
): { d: string; midX: number; midY: number } {
  const auto = autoSides(from, to)
  const fromSide = (explicitFromSide as NodeSide) || auto.fromSide
  const toSide = (explicitToSide as NodeSide) || auto.toSide
  const a1 = getSidePoint(from, fromSide)
  const a2 = getSidePoint(to, toSide)
  const n1 = sideNormal(fromSide)
  const n2 = sideNormal(toSide)
  const dist = Math.hypot(a2.x - a1.x, a2.y - a1.y)
  // 曲率随间距增长，夹在 [30,160]，避免近距离打结、远距离过直
  const curve = Math.min(Math.max(dist * 0.4, 30), 160)
  let c1 = { x: a1.x + n1.x * curve, y: a1.y + n1.y * curve }
  let c2 = { x: a2.x + n2.x * curve, y: a2.y + n2.y * curve }
  // 平行/双向边的横向错开：沿两锚点连线的垂直方向弯曲（规范化 perp 保证同一通道多条边一致错开）
  if (bowOffset !== 0 && dist > 0.01) {
    // 用排序后的锚点向量作为规范方向，与边的方向（正/反）无关
    const swap = a1.x !== a2.x ? a1.x > a2.x : a1.y > a2.y
    const s = swap ? { x: a2.x, y: a2.y } : { x: a1.x, y: a1.y }
    const t = swap ? { x: a1.x, y: a1.y } : { x: a2.x, y: a2.y }
    const len = Math.hypot(t.x - s.x, t.y - s.y) || 1
    const perp = { x: -(t.y - s.y) / len, y: (t.x - s.x) / len }
    c1 = { x: c1.x + perp.x * bowOffset, y: c1.y + perp.y * bowOffset }
    c2 = { x: c2.x + perp.x * bowOffset, y: c2.y + perp.y * bowOffset }
  }
  // 三次贝塞尔 t=0.5 处的点，作为标签锚点
  const midX = 0.125 * a1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * a2.x
  const midY = 0.125 * a1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * a2.y
  const d = `M ${a1.x} ${a1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${a2.x} ${a2.y}`
  return { d, midX, midY }
}

/**
 * 为所有 edge 计算横向弯曲偏移：同一“通道”（无序的锚点对）上的多条边扇开。
 * 通道签名用 (nodeId:side) 的无序对，确保 a→s 与 s→a 被归为同组。
 */
export function computeEdgeBows(edges: CanvasEdge[], nodes: CanvasNode[]): Map<string, number> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const auto = (e: CanvasEdge): { fromSide: NodeSide; toSide: NodeSide } => {
    const f = nodeMap.get(e.fromNode)
    const t = nodeMap.get(e.toNode)
    if (!f || !t) return { fromSide: 'right', toSide: 'left' }
    const a = autoSides(f, t)
    return { fromSide: (e.fromSide as NodeSide) || a.fromSide, toSide: (e.toSide as NodeSide) || a.toSide }
  }
  // 分组
  const groups = new Map<string, string[]>()
  for (const e of edges) {
    const { fromSide, toSide } = auto(e)
    const endA = `${e.fromNode}:${fromSide}`
    const endB = `${e.toNode}:${toSide}`
    const key = endA < endB ? `${endA}|${endB}` : `${endB}|${endA}`
    const arr = groups.get(key)
    if (arr) arr.push(e.id)
    else groups.set(key, [e.id])
  }
  const SPACING = 26
  const bows = new Map<string, number>()
  for (const [, ids] of groups) {
    const count = ids.length
    ids.forEach((id, i) => {
      bows.set(id, count === 1 ? 0 : (i - (count - 1) / 2) * SPACING)
    })
  }
  return bows
}

// ===== 簇导出 =====

/** 给定选中节点 id 集，抽取子集（选中节点 + 两端都在集内的边）并平移到原点附近 */
export function extractCluster(
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
  selectedIds: Set<string>,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes = allNodes.filter((n) => selectedIds.has(n.id))
  const idSet = new Set(nodes.map((n) => n.id))
  const edges = allEdges.filter((e) => idSet.has(e.fromNode) && idSet.has(e.toNode))
  // 平移到左上角附近，保留相对布局
  let minX = Infinity, minY = Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
  }
  const dx = minX === Infinity ? 0 : minX - 40
  const dy = minY === Infinity ? 0 : minY - 40
  return {
    nodes: nodes.map((n) => ({ ...n, x: n.x - dx, y: n.y - dy })),
    edges: edges.map((e) => ({ ...e })),
  }
}

/** 由节点/边生成 .md 伴侣内容（agent 可搜索） */
export function buildClusterMarkdown(
  name: string,
  context: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): string {
  const lines: string[] = [`# ${name}`, '']
  if (context.trim()) {
    lines.push(context.trim(), '')
  }
  const textNodes = nodes.filter((n) => n.type !== 'group')
  if (textNodes.length > 0) {
    lines.push('## 节点', '')
    for (const n of textNodes) {
      const t = (n.text || '').replace(/\n+/g, ' ').trim()
      if (t) lines.push(`- ${t}`)
    }
    lines.push('')
  }
  if (edges.length > 0) {
    const nameOf = (id: string): string => {
      const n = nodes.find((x) => x.id === id)
      return (n?.text || id).replace(/\n+/g, ' ').trim().slice(0, 40)
    }
    lines.push('## 连线', '')
    for (const e of edges) {
      const label = e.label ? ` 【${e.label}】` : ''
      lines.push(`- ${nameOf(e.fromNode)} →${label} ${nameOf(e.toNode)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 用选中节点的包围盒创建一个 group 节点（包住选中，带 padding） */
export function makeGroupForSelection(nodes: CanvasNode[], label: string): CanvasNode {
  const PAD = 24
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  return {
    id: generateId(),
    type: 'group',
    x: Math.round(minX - PAD),
    y: Math.round(minY - PAD - 22), // 预留顶部标题空间
    width: Math.round(maxX - minX + PAD * 2),
    height: Math.round(maxY - minY + PAD * 2 + 22),
    text: '',
    label,
  }
}

// ===== 力导向初始布局（一次性，之后固定） =====

export function runForceLayout(nodes: CanvasNode[], edges: CanvasEdge[]): void {
  if (nodes.length === 0) return
  const k = 280
  nodes.forEach((n, i) => {
    if (n.x === 0 && n.y === 0) {
      const cols = Math.ceil(Math.sqrt(nodes.length))
      n.x = (i % cols) * (DEFAULT_WIDTH + 80) + 50
      n.y = Math.floor(i / cols) * (DEFAULT_HEIGHT + 60) + 50
    }
  })
  const iters = 100
  for (let it = 0; it < iters; it++) {
    const fx = nodes.map(() => 0)
    const fy = nodes.map(() => 0)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i]!.x - nodes[j]!.x
        const dy = nodes[i]!.y - nodes[j]!.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (k * k) / d
        fx[i]! += (dx / d) * f
        fy[i]! += (dy / d) * f
        fx[j]! -= (dx / d) * f
        fy[j]! -= (dy / d) * f
      }
    }
    for (const e of edges) {
      const i = nodes.findIndex((n) => n.id === e.fromNode)
      const j = nodes.findIndex((n) => n.id === e.toNode)
      if (i < 0 || j < 0) continue
      const dx = nodes[i]!.x - nodes[j]!.x
      const dy = nodes[i]!.y - nodes[j]!.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d * d) / k
      fx[i]! -= (dx / d) * f
      fy[i]! -= (dy / d) * f
      fx[j]! += (dx / d) * f
      fy[j]! += (dy / d) * f
    }
    const temp = (1 - it / iters) * 35
    for (let i = 0; i < nodes.length; i++) {
      const mag = Math.sqrt(fx[i]! ** 2 + fy[i]! ** 2) || 1
      const step = Math.min(mag, temp)
      nodes[i]!.x += (fx[i]! / mag) * step
      nodes[i]!.y += (fy[i]! / mag) * step
    }
  }
}

// ===== 智能对齐辅助线（Smart Guides） =====

/** 对齐线的类型：水平 or 垂直 */
export interface GuideLine {
  /** 坐标值（水平线=y，垂直线=x） */
  pos: number
  /** 'h' = 水平线（固定 y），'v' = 垂直线（固定 x） */
  orient: 'h' | 'v'
  /** 起止范围（用于画线长度） */
  start: number
  end: number
}

const SNAP_THRESHOLD = 6

/**
 * 计算拖拽中的节点与其它静止节点的对齐吸附。
 * 检查：左边缘、中心、右边缘 三条线在 x 和 y 方向的对齐。
 * 返回吸附偏移量和对齐辅助线。
 */
export function computeSnapGuides(
  dragRects: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  otherNodes: CanvasNode[],
): { snapDx: number; snapDy: number; guides: GuideLine[] } {
  if (dragRects.length === 0 || otherNodes.length === 0) {
    return { snapDx: 0, snapDy: 0, guides: [] }
  }

  let bestDx: number | null = null
  let bestDy: number | null = null
  let bestDxDist = SNAP_THRESHOLD
  let bestDyDist = SNAP_THRESHOLD
  const guides: GuideLine[] = []

  // 收集静止节点的锚点
  const staticXAnchors: Array<{ val: number; min: number; max: number }> = []
  const staticYAnchors: Array<{ val: number; min: number; max: number }> = []
  for (const n of otherNodes) {
    if (n.type === 'group') continue
    staticXAnchors.push(
      { val: n.x, min: n.y, max: n.y + n.height }, // 左边缘
      { val: n.x + n.width / 2, min: n.y, max: n.y + n.height }, // 中心
      { val: n.x + n.width, min: n.y, max: n.y + n.height }, // 右边缘
    )
    staticYAnchors.push(
      { val: n.y, min: n.x, max: n.x + n.width },
      { val: n.y + n.height / 2, min: n.x, max: n.x + n.width },
      { val: n.y + n.height, min: n.x, max: n.x + n.width },
    )
  }

  // 对每个拖拽节点，检查锚点对齐
  for (const drag of dragRects) {
    const dragXAnchors = [drag.x, drag.x + drag.width / 2, drag.x + drag.width]
    const dragYAnchors = [drag.y, drag.y + drag.height / 2, drag.y + drag.height]

    // X 方向对齐
    for (const dx of dragXAnchors) {
      for (const sa of staticXAnchors) {
        const dist = Math.abs(dx - sa.val)
        if (dist < bestDxDist) {
          bestDxDist = dist
          bestDx = sa.val - dx
          guides.push({ pos: sa.val, orient: 'v', start: Math.min(drag.y, sa.min), end: Math.max(drag.y + drag.height, sa.max) })
        } else if (dist < SNAP_THRESHOLD && bestDx !== null) {
          // 同距离的额外辅助线
        }
      }
    }

    // Y 方向对齐
    for (const dy of dragYAnchors) {
      for (const sa of staticYAnchors) {
        const dist = Math.abs(dy - sa.val)
        if (dist < bestDyDist) {
          bestDyDist = dist
          bestDy = sa.val - dy
          guides.push({ pos: sa.val, orient: 'h', start: Math.min(drag.x, sa.min), end: Math.max(drag.x + drag.width, sa.max) })
        }
      }
    }
  }

  // 只保留最佳 snap 对应的辅助线
  const finalGuides: GuideLine[] = []
  if (bestDx !== null) {
    // 找到对应方向的辅助线（取最长的）
    const vGuides = guides.filter((g) => g.orient === 'v')
    if (vGuides.length > 0) {
      vGuides.sort((a, b) => (b.end - b.start) - (a.end - a.start))
      finalGuides.push(vGuides[0]!)
    }
  }
  if (bestDy !== null) {
    const hGuides = guides.filter((g) => g.orient === 'h')
    if (hGuides.length > 0) {
      hGuides.sort((a, b) => (b.end - b.start) - (a.end - a.start))
      finalGuides.push(hGuides[0]!)
    }
  }

  return { snapDx: bestDx ?? 0, snapDy: bestDy ?? 0, guides: finalGuides }
}

// ===== 剪贴板 =====

export interface CanvasClipboard {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}
