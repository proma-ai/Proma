/**
 * 文件树行的共享布局常量与祖先链竖线渲染。
 * FileBrowser 与 SidePanel 的附加目录树共用同一套 sticky / 引导线视觉。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

const TREE_ROW_HEIGHT = 32
const TREE_ROW_HORIZONTAL_MARGIN = 8
const TREE_INDENT_WIDTH = 16
/**
 * sticky 栈最多堆叠的层数，超出此深度的目录行不再 sticky（随滚动消失），
 * 避免多层重叠在同一 top 槽位导致下层覆盖上层。参考 VS Code Explorer 默认 = 7。
 */
const MAX_STICKY_DEPTH = 8

/** depth 是否允许作为 sticky 行（超出栈深的层退化为普通滚动行）。 */
export function canBeSticky(depth: number): boolean {
  return depth < MAX_STICKY_DEPTH
}

/**
 * sticky 目录行的基础视觉样式：position: sticky + 与列表容器一致的不透明底色。
 * 不包含 top / z-index 定位——调用方需自行通过 inline style（用 computeTreeRowLayout 的结果）
 * 或 Tailwind 的 top- / z- class 指定。深度 > 0 的递归节点用 inline style 传动态值；
 * 固定 depth=0 的根行可直接拼 'top-0 z-10'。
 * 阴影由 globals.css 中的 :has() 规则按 sticky 链路最末一行动态附加。
 */
export const STICKY_ROW_BASE_CLASS = 'sticky bg-content-area'

export interface TreeRowLayout {
  paddingLeft: number
  guideLeft: number
  stickyTop: number
  stickyZIndex: number
}

export function computeTreeRowLayout(depth: number): TreeRowLayout {
  // paddingLeft 合并原本 mx-2 的 8px 外边距，避免 sticky/普通两种状态下文字位置左右跳动
  const paddingLeft = TREE_ROW_HORIZONTAL_MARGIN + 8 + depth * TREE_INDENT_WIDTH
  // 调用方保证 depth < MAX_STICKY_DEPTH 才会启用 sticky，所以这里直接乘 depth 即可
  return {
    paddingLeft,
    // 外边距已合进 paddingLeft，guideLeft 只需 +7 对齐箭头中心
    guideLeft: paddingLeft + 7,
    stickyTop: depth * TREE_ROW_HEIGHT,
    // 起点 10 已足够压住普通行内元素；保持外层目录在更上层以遮住下方滚过的内层。
    stickyZIndex: Math.max(1, 10 - depth),
  }
}

interface AncestorGuidesProps {
  depth: number
  isSelected: boolean
}

/**
 * sticky 行内按 depth 绘制祖先链竖线，贯穿整行。
 * 自己的子项引导线不在这里绘制——交给下方子项容器（或下层 sticky 子行的祖先线）。
 * 选中态下用 accent-foreground/30 替代 border/70，避免被 bg-accent 不透明背景吃掉对比度。
 */
export function AncestorGuides({ depth, isSelected }: AncestorGuidesProps): React.ReactElement | null {
  if (depth <= 0) return null
  return (
    <>
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={`ancestor-guide-${i}`}
          aria-hidden="true"
          className={cn(
            'file-tree-guide pointer-events-none absolute top-0 bottom-0 w-px',
            isSelected ? 'bg-accent-foreground/30' : 'bg-border/70',
          )}
          style={{ left: TREE_ROW_HORIZONTAL_MARGIN + 8 + i * TREE_INDENT_WIDTH + 7 }}
        />
      ))}
    </>
  )
}
